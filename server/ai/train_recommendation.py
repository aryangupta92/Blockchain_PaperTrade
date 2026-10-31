"""
train_recommendation.py — train the segment-recommendation model from dataset.json.

Needs: pip install scikit-learn pandas numpy yfinance (yfinance optional; used for sector momentum features)
Falls back to skill-only features when market fetch fails.

Usage:
  python server/ai/train_recommendation.py --data server/ai/dataset.json --out server/ai/weights.json

Output weights.json is shared with server/services/recommendationEngine.js:
  { version, wSkill, wMarket, wTemperament, segments: {IT: bias, ...} }
The sklearn model itself is saved to server/ai/segment_model.pkl for inspection;
the Node runtime uses the lightweight linear weights (no sklearn needed in prod).
"""
import argparse, json, os
from datetime import datetime

def load_data(path):
    with open(path) as f:
        return json.load(f)

def sector_of(symbol, fallback=None):
    s = (symbol or '').upper()
    rules = [
        ('Banking', ('HDFCBANK','SBIN','ICICIBANK','AXISBANK','KOTAKBANK')),
        ('IT', ('TCS','INFY','WIPRO','HCLTECH','TECHM')),
        ('Energy', ('RELIANCE','ONGC','NTPC','POWERGRID')),
        ('Pharma', ('SUNPHARMA','DIVISLAB','CIPLA','DRREDDY')),
        ('Auto', ('MARUTI','TATAMOTORS','EICHERMOT','M&M')),
        ('FMCG', ('ITC','HINDUNILVR','NESTLEIND','BRITANNIA')),
        ('Metals', ('TATASTEEL','HINDALCO','JSWSTEEL')),
    ]
    for seg, syms in rules:
        if any(x in s for x in syms):
            return seg
    return fallback or 'LargeCap'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='server/ai/dataset.json')
    ap.add_argument('--out', default='server/ai/weights.json')
    args = ap.parse_args()

    data = load_data(args.data)
    rows = data.get('rows', [])
    journals = data.get('journals', [])
    print(f'rows={len(rows)} journals={len(journals)}')

    # --- journal-derived temperament priors per user ---
    fomo_users = set()
    for j in journals:
        blob = ' '.join(str(j.get(k) or '') for k in ('emotionOnEntry','emotionOnExit','setup')).upper()
        if 'FOMO' in blob or 'REVENGE' in blob:
            fomo_users.add(j.get('userId'))

    # --- per-segment win rates (skill signal) ---
    from collections import defaultdict
    seg_wins = defaultdict(list)
    for r in rows:
        seg = r.get('sector') or sector_of(r.get('symbol'))
        seg_wins[seg].append(r.get('win', 0))

    seg_skill = {s: (sum(v) / len(v) if v else 0.5) for s, v in seg_wins.items()}
    print('segment win-rate:', {k: round(v, 3) for k, v in seg_skill.items()})

    # --- optional sklearn model: P(win | segment, retPct, fomo_user) ---
    biases = {}
    try:
        import pandas as pd
        from sklearn.linear_model import LogisticRegression
        df = pd.DataFrame([{
            'seg': r.get('sector') or sector_of(r.get('symbol')),
            'ret': r.get('retPct', 0),
            'fomo': 1 if r.get('userId') in fomo_users else 0,
            'win': r.get('win', 0),
        } for r in rows])
        if len(df) >= 20 and df['win'].nunique() > 1:
            X = pd.get_dummies(df[['seg', 'ret', 'fomo']], columns=['seg'])
            y = df['win']
            clf = LogisticRegression(max_iter=500)
            clf.fit(X, y)
            print(f'sklearn acc(train)={clf.score(X, y):.3f} features={list(X.columns)}')
            # convert segment coefficients to Node biases (clamped)
            import pickle
            os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
            with open(os.path.join(os.path.dirname(args.out), 'segment_model.pkl'), 'wb') as f:
                pickle.dump({'model': clf, 'columns': list(X.columns)}, f)
            coefs = dict(zip(X.columns, clf.coef_[0]))
            for col, c in coefs.items():
                if col.startswith('seg_'):
                    seg = col.replace('seg_', '', 1)
                    biases[seg] = round(float(max(-0.3, min(0.3, c * 0.15))), 4)
            print('learned biases:', biases)
        else:
            print('too few rows for sklearn; using win-rate heuristic biases')
            for s, w in seg_skill.items():
                biases[s] = round(max(-0.2, min(0.2, (w - 0.5) * 0.5)), 4)
    except ImportError as e:
        print(f'sklearn/pandas not installed ({e}); using heuristic biases')
        for s, w in seg_skill.items():
            biases[s] = round(max(-0.2, min(0.2, (w - 0.5) * 0.5)), 4)

    # --- merge with existing weights (keep hand-tuned wSkill/wMarket/wTemperament) ---
    weights = {}
    if os.path.exists(args.out):
        with open(args.out) as f:
            weights = json.load(f)
    weights.update({
        'version': int(weights.get('version', 1)) + 1,
        'wSkill': float(weights.get('wSkill', 0.45)),
        'wMarket': float(weights.get('wMarket', 0.35)),
        'wTemperament': float(weights.get('wTemperament', 0.20)),
        'segments': {**(weights.get('segments', {})), **biases},
        'trainedAt': datetime.utcnow().isoformat() + 'Z',
        'trainRows': len(rows),
    })
    os.makedirs(os.path.dirname(args.out) or '.', exist_ok=True)
    with open(args.out, 'w') as f:
        json.dump(weights, f, indent=2)
    print(f'wrote {args.out}: version={weights["version"]}')

if __name__ == '__main__':
    main()
