import { ArrowRight, BookOpenText, CircleHelp, Settings2, SlidersHorizontal, Target } from 'lucide-react';
import { Link } from 'react-router-dom';

const secondaryDestinations = [
  { title: 'Target setting', description: 'Regional target planning', path: '/targets', icon: Target },
  { title: 'What-if simulation', description: 'Scenario planning tools', path: '/simulate', icon: SlidersHorizontal },
  { title: 'Settings', description: 'Application preferences', path: '/settings', icon: Settings2 },
];

export const More = () => (
  <div className="page-container animate-fade-in">
    <section className="page-intro"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>More</h2><p className="text-secondary">Secondary destinations and data context.</p></div></section>
    <section className="more-links">
      {secondaryDestinations.map(({ title, description, path, icon: Icon }) => (
        <Link className="surface more-link" to={path} key={path}>
          <span className="more-icon"><Icon size={19} /></span>
          <span><strong>{title}</strong><small>{description}</small></span>
          <span className="planned-badge">PLANNED</span>
          <ArrowRight size={17} className="muted-icon" />
        </Link>
      ))}
    </section>
    <section className="surface methodology-card">
      <div className="methodology-title"><span className="more-icon"><BookOpenText size={19} /></span><div><p className="eyebrow">METHODOLOGY</p><h2>Labour Demand Index · LDI-v1</h2></div></div>
      <p>Each available direct-demand source is percentile-normalized to a 0–100 scale using log-transformed counts and the full source reference population. Available sources are combined using provisional weights; missing sources are excluded and remaining weights renormalized.</p>
      <div className="weight-list"><span>Job postings <strong>50%</strong></span><span>Industry hiring <strong>30%</strong></span><span>NCS vacancies <strong>20% · unavailable</strong></span></div>
      <div className="disclosure-banner"><CircleHelp size={16} /><span>Weights are not empirically validated. Current seed records are synthetic demonstrations; no live source integration is claimed.</span></div>
      <Link to="/analytics" className="quiet-link">Inspect a district index <ArrowRight size={15} /></Link>
    </section>
    <p className="data-disclosure">KaushalPulse is a labour-market intelligence prototype. Target-setting and scenario-planning workflows remain under development.</p>
  </div>
);

export const StatusPage = ({ title }: { title: string }) => (
  <div className="page-container animate-fade-in">
    <section className="page-intro"><div><p className="eyebrow">SECONDARY DESTINATION</p><h2>{title}</h2></div></section>
    <section className="surface placeholder-card">
      <span className="planned-badge">NOT AVAILABLE YET</span>
      <h3>{title} is not implemented</h3>
      <p className="text-secondary">This destination remains available in navigation for continuity, but its workflow is not yet functional.</p>
      <Link to="/more" className="quiet-link">Return to More <ArrowRight size={15} /></Link>
    </section>
  </div>
);
