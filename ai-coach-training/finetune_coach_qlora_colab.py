#!/usr/bin/env python3
"""
BlockTrade AI Trading Coach — QLoRA Fine-Tuning Script for Google Colab T4 (16 GB VRAM)
======================================================================================
Designed for developers WITHOUT a local NVIDIA GPU:
  1. Upload `ai-coach-training/data/train.jsonl`, `eval.jsonl`, and this script to Google Colab
     (Runtime -> Change runtime type -> T4 GPU).
  2. Install dependencies:
       !pip install -q "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
       !pip install -q --no-deps trl peft accelerate bitsandbytes datasets
  3. Run:
       !python finetune_coach_qlora_colab.py --base-model unsloth/Qwen2.5-3B-Instruct-bnb-4bit --export-gguf
     (Use `Qwen2.5-3B-Instruct` for fast CPU Ollama inference on standard laptops,
      or `Qwen2.5-7B-Instruct` for higher reasoning depth on 16GB+ RAM machines.)
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Fine-tune BlockTrade AI Trading Coach via 4-bit QLoRA")
    p.add_argument(
        "--base-model",
        default="unsloth/Qwen2.5-3B-Instruct-bnb-4bit",
        help="HuggingFace/Unsloth 4-bit base model (3B recommended for fast laptop CPU Ollama, 7B for deeper coaching)",
    )
    p.add_argument("--train-file", default="data/train.jsonl")
    p.add_argument("--eval-file", default="data/eval.jsonl")
    p.add_argument("--output-dir", default="outputs/blocktrade-coach-lora")
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--max-seq-len", type=int, default=2048)
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--export-gguf", action="store_true", help="Export Q4_K_M GGUF for local Ollama deployment")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    # Lazy imports so script can be linted cleanly on CPU machines without CUDA installed
    import torch
    from datasets import load_dataset
    from trl import SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        raise RuntimeError(
            "No CUDA GPU detected! Run this script on Google Colab (T4 GPU), Kaggle P100/T4, "
            "or a cloud GPU instance. On your local CPU laptop, run the exported GGUF via Ollama."
        )

    use_unsloth = False
    try:
        from unsloth import FastLanguageModel  # type: ignore

        use_unsloth = True
    except ImportError:
        use_unsloth = False

    if use_unsloth:
        print(f"[Unsloth] Loading 4-bit model: {args.base_model}")
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=args.base_model,
            max_seq_length=args.max_seq_len,
            dtype=None,
            load_in_4bit=True,
        )
        model = FastLanguageModel.get_peft_model(
            model,
            r=args.lora_r,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            lora_alpha=args.lora_alpha,
            lora_dropout=0.05,
            bias="none",
            use_gradient_checkpointing="unsloth",
            random_state=2026,
        )
    else:
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

        hf_model = args.base_model.replace("unsloth/", "Qwen/").replace("-bnb-4bit", "")
        print(f"[Transformers + PEFT] Loading 4-bit NF4 model: {hf_model}")
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.float16,
        )
        tokenizer = AutoTokenizer.from_pretrained(hf_model, trust_remote_code=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            hf_model,
            quantization_config=bnb_config,
            device_map="auto",
            trust_remote_code=True,
        )
        model = prepare_model_for_kbit_training(model)
        lora_cfg = LoraConfig(
            r=args.lora_r,
            lora_alpha=args.lora_alpha,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        )
        model = get_peft_model(model, lora_cfg)

    ds = load_dataset("json", data_files={"train": args.train_file, "eval": args.eval_file})

    def format_chat(example: dict) -> dict:
        text = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    ds = ds.map(format_chat)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    training_args = SFTConfig(
        output_dir=str(out_dir),
        dataset_text_field="text",
        max_length=args.max_seq_len,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        warmup_ratio=0.08,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="epoch",
        optim="adamw_8bit",
        lr_scheduler_type="cosine",
        weight_decay=0.01,
        seed=2026,
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=ds["train"],
        eval_dataset=ds["eval"],
        args=training_args,
    )

    print("Starting QLoRA fine-tuning...")
    trainer.train()

    adapter_dir = out_dir / "adapter"
    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"Saved LoRA adapter -> {adapter_dir}")

    if args.export_gguf:
        gguf_dir = out_dir / "gguf"
        if use_unsloth:
            print(f"Exporting Q4_K_M GGUF for Ollama -> {gguf_dir}")
            model.save_pretrained_gguf(str(gguf_dir), tokenizer, quantization_method="q4_k_m")
            print("Done! Download the .gguf file, place it next to ai-coach-training/Modelfile, and run:")
            print("  ollama create blocktrade-coach -f Modelfile")
        else:
            print(
                "Tip: Install `unsloth` in Colab for 1-line GGUF export, or merge the LoRA adapter "
                "and convert via llama.cpp's `convert_hf_to_gguf.py` + `llama-quantize ... q4_k_m`."
            )


if __name__ == "__main__":
    main()
