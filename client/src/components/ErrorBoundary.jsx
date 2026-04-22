import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '24px',
          background: 'var(--loss-bg)',
          border: '1px solid rgba(244,63,94,0.3)',
          borderRadius: 12,
          color: 'var(--loss)',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>⚠️ Component Error</div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>{this.state.error?.message}</div>
          <button
            style={{ background: 'var(--loss)', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
