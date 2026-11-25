import { useEffect } from 'react';

export interface HotkeyBindings {
  onBuy: () => void;
  onSell: () => void;
  onOpenChart: () => void;
  onNavigate: (navId: string) => void;
  onFocusSearch: () => void;
  onToggleWatchlist: () => void;
  onToggleShortcutsHelp: () => void;
  onEscape: () => void;
}

export const TERMINAL_SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: 'Ctrl + B', description: 'Open BUY Order Ticket (active symbol)' },
  { keys: 'Ctrl + S', description: 'Open SELL Order Ticket (active symbol)' },
  { keys: 'Ctrl + C', description: 'Open Chart for active symbol' },
  { keys: 'Ctrl + K or /', description: 'Focus Global Instrument Search' },
  { keys: 'Alt + M', description: 'Market Overview' },
  { keys: 'Alt + W', description: 'Toggle Left Multi-Watchlist Drawer' },
  { keys: 'Alt + O', description: 'Orders, Super, Forever GTT & Baskets' },
  { keys: 'Alt + P', description: 'Positions, Holdings, MTF & Pledge' },
  { keys: 'Alt + F', description: 'Option Chain, Strategy Builder & Flash Trade' },
  { keys: 'Alt + S', description: 'Market Screener & Treemap Heatmap' },
  { keys: 'Alt + D', description: "Trader's Diary & P&L Calendar" },
  { keys: 'Alt + G', description: "Trader's Controls, Alerts & Webhooks" },
  { keys: 'Alt + B', description: 'Blockchain Audit Trail' },
  { keys: '?', description: 'Toggle Keyboard Shortcuts Cheat-Sheet' },
  { keys: 'Esc', description: 'Close active modal / menu' },
];

export function useHotkeys(bindings: HotkeyBindings, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target?.isContentEditable);

      if (e.key === 'Escape') {
        bindings.onEscape();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        bindings.onFocusSearch();
        return;
      }

      if (isTyping) return;

      if (e.key === '/') {
        e.preventDefault();
        bindings.onFocusSearch();
        return;
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        bindings.onToggleShortcutsHelp();
        return;
      }

      if (e.ctrlKey && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'b') {
          e.preventDefault();
          bindings.onBuy();
        } else if (k === 's') {
          e.preventDefault();
          bindings.onSell();
        } else if (k === 'c' && !window.getSelection()?.toString()) {
          e.preventDefault();
          bindings.onOpenChart();
        }
        return;
      }

      if (e.altKey && !e.ctrlKey) {
        const k = e.key.toLowerCase();
        const navMap: Record<string, string> = {
          m: 'overview',
          o: 'orders',
          p: 'positions',
          h: 'positions',
          f: 'option-chain',
          s: 'screener',
          d: 'diary',
          g: 'controls',
          b: 'blockchain',
        };
        if (k === 'w') {
          e.preventDefault();
          bindings.onToggleWatchlist();
        } else if (navMap[k]) {
          e.preventDefault();
          bindings.onNavigate(navMap[k]);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings, enabled]);
}
