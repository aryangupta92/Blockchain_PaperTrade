import { useState, useEffect } from 'react';
import { Newspaper, ExternalLink } from 'lucide-react';
import api from '../../services/api';

export default function NewsPage() {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getNews()
      .then(data => setNews(data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Newspaper size={18} style={{ color: 'var(--accent-primary)' }} />
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Market News & Events</h2>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 12 }} />)}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {news.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              News feed unavailable. Check your internet connection.
            </div>
          )}
          {news.map((item, i) => (
            <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" className="card news-card">
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                {item.thumbnail && (
                  <img
                    src={item.thumbnail}
                    alt=""
                    style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 6 }}>
                    {item.title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--accent-secondary)' }}>{item.publisher}</span>
                    <span>·</span>
                    <span>{new Date(item.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <ExternalLink size={10} style={{ marginLeft: 'auto' }} />
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      <style>{`.news-card { transition: var(--transition); cursor: pointer; } .news-card:hover { border-color: var(--border-active); transform: translateY(-1px); background: var(--bg-card-hover); }`}</style>
    </div>
  );
}
