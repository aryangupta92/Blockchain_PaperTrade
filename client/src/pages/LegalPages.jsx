import './LegalPages.css';

const SECTIONS = {
  disclaimer: [
    { h: '1. Purpose', p: 'BlockTrade provides a fully simulated trading environment. This disclaimer governs your use of the platform and does not constitute investment advice.' },
    { h: '2. No Real Money', p: 'All trading, positions, funds and settlements on BlockTrade are virtual. No real capital is deployed, exchanged or risked through the platform.' },
    { h: '3. Market Data', p: 'Market data is provided for educational and simulation purposes. While we source live NSE/BSE quotes via DhanHQ and Yahoo Finance, data may be delayed or aggregated and should not be relied upon for live trading decisions.' },
    { h: '4. No Investment Advice', p: 'Nothing on this platform constitutes investment, trading or financial advice. Trading involves substantial risk of loss and is not suitable for every investor.' },
    { h: '5. Past Performance', p: 'Simulated performance is not indicative of future results. Simulated gains or losses do not guarantee any future outcome.' },
  ],
  privacy: [
    { h: '1. Data We Collect', p: 'Account details (name, email, phone, PAN), trading activity within the simulation, watchlists, journals, alerts and audit logs.' },
    { h: '2. Purpose', p: 'To operate the simulation, personalise watchlists, power alerts, maintain trade history and provide AI coaching insights.' },
    { h: '3. Blockchain Records', p: 'Trade hashes may be recorded on a permissionless EVM network for tamper-evidence. These records contain no personal funds data.' },
    { h: '4. Data Sharing', p: 'We do not sell personal data. Data is shared only with market data providers and infrastructure vendors strictly necessary to operate the service.' },
    { h: '5. Your Rights', p: 'You may request access, correction or deletion of personal data by contacting support. Data retention follows operational necessity.' },
  ],
  terms: [
    { h: '1. Acceptance', p: 'By accessing or using BlockTrade you agree to these terms. If you do not agree, please discontinue use.' },
    { h: '2. Simulation Only', p: 'The service is provided strictly for paper trading. You may not use it for live capital allocation.' },
    { h: '3. Acceptable Use', p: 'You agree not to attempt to disrupt the platform, probe security controls or circumvent risk limits.' },
    { h: '4. Liability', p: 'To the maximum extent permitted by law, BlockTrade is not liable for trading losses arising from use of simulated data.' },
    { h: '5. Changes', p: 'These terms may be updated; continued use constitutes acceptance of the revised terms.' },
  ],
  dpdp: [
    { h: '1. Scope', p: 'This section covers handling of personal data as defined under the Digital Personal Data Protection Act, 2023.' },
    { h: '2. Consent', p: 'Consent is obtained at registration. You may withdraw consent via account deletion requests.' },
    { h: '3. Rights', p: 'You hold rights to access, correct, erase and port your personal data.' },
    { h: '4. Grievance', p: 'Grievances may be escalated to the BlockTrade data protection officer via support channels.' },
    { h: '5. Retention', p: 'Personal data is retained only as long as needed for the stated purposes or legal obligations.' },
  ],
};

function LegalPage({ kind, title, updated, intro }) {
  const sections = SECTIONS[kind] || [];
  return (
    <div className="lp-legal">
      <div className="lp-legal-card">
        <div className="lp-legal-eyebrow">Legal &amp; Compliance</div>
        <h1 className="lp-legal-title">{title}</h1>
        <div className="lp-legal-updated">Last updated: {updated}</div>
        {intro ? <p className="lp-legal-intro">{intro}</p> : null}
        {sections.map((s) => (
          <section key={s.h} className="lp-legal-section">
            <h2>{s.h}</h2>
            <p>{s.p}</p>
          </section>
        ))}
        <section className="lp-legal-section">
          <h2>Contact</h2>
          <p>For questions about this document, reach out via the in-app support desk or support@blocktrade.example.</p>
        </section>
      </div>
    </div>
  );
}

export function DisclaimerPage() {
  return <LegalPage kind="disclaimer" title="SEBI Risk Disclaimer" updated="October 2026" intro="Simulated trading notice required for Indian retail traders." />;
}
export function PrivacyPolicyPage() {
  return <LegalPage kind="privacy" title="Privacy Policy" updated="October 2026" intro="How BlockTrade collects, uses and protects personal data." />;
}
export function TermsOfServicePage() {
  return <LegalPage kind="terms" title="Terms of Service" updated="October 2026" intro="The rules governing your use of the BlockTrade platform." />;
}
export function DpdpPage() {
  return <LegalPage kind="dpdp" title="DPDP Act Compliance" updated="October 2026" intro="Digital Personal Data Protection notice for Indian users." />;
}
