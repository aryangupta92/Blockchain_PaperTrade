# BlockTrade AI Trading Coach — Custom QLoRA Model Training Kit (No Local GPU Needed)

Train your own **SEBI-compliant Indian Stock Market & Platform Coach LLM** for **free on Google Colab T4 (16 GB VRAM)** and run it locally on **any regular Windows/Mac/Linux laptop CPU** via Ollama — or switch between `local-rag`, `ollama`, and `gemini` in `.env`.

---

## Why This Hybrid Architecture Works Best

1. **Works Out-of-the-Box Today (`AI_COACH_PROVIDER=local-rag`):** Zero GPU, zero API fees. Uses our verified Indian market RAG knowledge base + live Prisma DB trade diagnostics + hard pre-LLM SEBI advice-refusal guardrail.
2. **Custom Fine-Tuned Model (`AI_COACH_PROVIDER=ollama`):** Fine-tunes `Qwen2.5-3B-Instruct` (fast on CPU laptops) or `Qwen2.5-7B-Instruct` via **4-bit QLoRA** on our curated Indian Market + Finance Act 2026 + SEBI F&O + BlockTrade Walkthrough + SEBI Refusal dataset.
3. **Hard Guardrail Always Active:** Even with a custom LLM attached, `backend/src/services/ai-coach/coachService.ts` runs `detectInvestmentAdviceRequest()` *before* invoking the model and `sanitizeUserMessage()` *after* — ensuring 100% SEBI compliance and zero external vendor leakage.

---

## Step-by-Step Training Guide (Free Google Colab T4 GPU)

### Step 1: Generate / Expand the Curated Dataset Locally (CPU)
```bash
cd platform/ml
python build_sebi_coach_dataset.py
```
This creates:
- `data/train.jsonl` — ChatML training pairs across 8 Indian market & SEBI-compliance categories.
- `data/eval.jsonl` — Stratified evaluation split (includes adversarial SEBI stock-tip refusals).
- Automatically asserts **0 upstream provider branding leaks**.

*(Tip: Add more Indian market Q&A pairs or broker-specific workflows into `build_sebi_coach_dataset.py` anytime to continuously improve your model!)*

### Step 2: Fine-Tune via QLoRA on Google Colab (Free T4 GPU)
**Option A — 1-Click Colab Notebook (Easiest):**
1. Open [Google Colab](https://colab.research.google.com/) → **File → Upload notebook** → choose `ai-coach-training/BlockTrade_AI_Coach_Colab_T4.ipynb`.
2. Set **Runtime → Change runtime type → T4 GPU**.
3. Click **Runtime → Run all**, upload `data/train.jsonl` & `data/eval.jsonl` when prompted, and wait ~5–10 minutes for `blocktrade-coach-q4_k_m.gguf` to auto-download!

**Option B — CLI Script in Colab / Cloud GPU:**
1. Upload `finetune_coach_qlora_colab.py`, `data/train.jsonl`, and `data/eval.jsonl` (into a `data/` folder).
2. Run in Colab cells:
```bash
!pip install -q "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
!pip install -q --no-deps trl peft accelerate bitsandbytes datasets
!python finetune_coach_qlora_colab.py \
  --base-model unsloth/Qwen2.5-3B-Instruct-bnb-4bit \
  --epochs 4 \
  --export-gguf
```
Training completes in **~5–10 minutes** on a free T4 GPU and outputs a quantized `Q4_K_M` `.gguf` file (~2.0 GB for 3B, ~4.7 GB for 7B).

### Step 3: Run Locally on Your Laptop CPU via Ollama
1. Install [Ollama](https://ollama.com/) on Windows/Mac/Linux (runs smoothly on CPU — no NVIDIA GPU required!).
2. Download the `.gguf` file from Colab, rename it to `blocktrade-coach-q4_k_m.gguf`, and place it inside `ai-coach-training/`.
3. Build and register the model:
```bash
cd platform/ml
ollama create blocktrade-coach -f Modelfile
```

### Step 4: Verify Compliance & Accuracy Before Connecting
```bash
python evaluate_coach_compliance.py --ollama-url http://127.0.0.1:11434 --model blocktrade-coach
```
Ensure **6/6 tests PASS** and **Provider Leaks: 0**!

### Step 5: Connect to BlockTrade Backend
Update `.env`:
```env
AI_COACH_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=blocktrade-coach
```
Restart `npm run dev` — the **AI Coach & Academy** tab will now stream grounded Indian-market RAG context + your live account diagnostics directly into your custom fine-tuned `blocktrade-coach` model (and automatically fall back to `local-rag` if Ollama is offline!).
