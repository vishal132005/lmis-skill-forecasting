/**
 * Seed script – populates SQLite with dummy data from the shared seed-data module.
 */
import path from 'path';
import fs from 'fs';
import { getDb, initializeDatabase } from './database';
import { config } from './config';

interface State { id: string; name: string; name_hi: string; name_mr: string; name_ta: string; lgd_code: number; lat: number; lng: number; }
interface District { id: string; state_id: string; name: string; name_hi: string; name_mr: string; name_ta: string; lgd_code: number; lat: number; lng: number; }
interface Sector { id: string; name: string; name_hi: string; name_mr: string; name_ta: string; color: string; }
interface Trade { id: string; sector_id: string; name: string; name_hi: string; name_ta: string; nco_code: string; nsqf_level: number; qp_code: string; }

const states: State[] = [
  { id: 'MH', name: 'Maharashtra', name_hi: 'महाराष्ट्र', name_mr: 'महाराष्ट्र', name_ta: 'மகாராஷ்டிரா', lgd_code: 27, lat: 19.7515, lng: 75.7139 },
  { id: 'UP', name: 'Uttar Pradesh', name_hi: 'उत्तर प्रदेश', name_mr: 'उत्तर प्रदेश', name_ta: 'உத்தரப் பிரதேசம்', lgd_code: 9, lat: 26.8467, lng: 80.9462 },
  { id: 'TN', name: 'Tamil Nadu', name_hi: 'तमिल नाडु', name_mr: 'तामिळनाडू', name_ta: 'தமிழ்நாடு', lgd_code: 33, lat: 11.1271, lng: 78.6569 },
];

const districts: District[] = [
  { id: 'MH-MUM', state_id: 'MH', name: 'Mumbai', name_hi: 'मुंबई', name_mr: 'मुंबई', name_ta: 'மும்பை', lgd_code: 519, lat: 19.076, lng: 72.8777 },
  { id: 'MH-PUN', state_id: 'MH', name: 'Pune', name_hi: 'पुणे', name_mr: 'पुणे', name_ta: 'புனே', lgd_code: 521, lat: 18.5204, lng: 73.8567 },
  { id: 'MH-NAG', state_id: 'MH', name: 'Nagpur', name_hi: 'नागपुर', name_mr: 'नागपूर', name_ta: 'நாக்பூர்', lgd_code: 530, lat: 21.1458, lng: 79.0882 },
  { id: 'MH-NAS', state_id: 'MH', name: 'Nashik', name_hi: 'नासिक', name_mr: 'नाशिक', name_ta: 'நாசிக்', lgd_code: 520, lat: 19.9975, lng: 73.7898 },
  { id: 'MH-AUR', state_id: 'MH', name: 'Aurangabad', name_hi: 'औरंगाबाद', name_mr: 'औरंगाबाद', name_ta: 'அவுரங்காபாத்', lgd_code: 524, lat: 19.8762, lng: 75.3433 },
  { id: 'MH-THN', state_id: 'MH', name: 'Thane', name_hi: 'ठाणे', name_mr: 'ठाणे', name_ta: 'தானே', lgd_code: 518, lat: 19.2183, lng: 72.9781 },
  { id: 'MH-SOL', state_id: 'MH', name: 'Solapur', name_hi: 'सोलापुर', name_mr: 'सोलापूर', name_ta: 'சோலாப்பூர்', lgd_code: 525, lat: 17.6599, lng: 75.9064 },
  { id: 'MH-KOL', state_id: 'MH', name: 'Kolhapur', name_hi: 'कोल्हापुर', name_mr: 'कोल्हापूर', name_ta: 'கோல்ஹாப்பூர்', lgd_code: 527, lat: 16.705, lng: 74.2433 },
  { id: 'UP-LKO', state_id: 'UP', name: 'Lucknow', name_hi: 'लखनऊ', name_mr: 'लखनौ', name_ta: 'லக்னோ', lgd_code: 163, lat: 26.8467, lng: 80.9462 },
  { id: 'UP-KAN', state_id: 'UP', name: 'Kanpur', name_hi: 'कानपुर', name_mr: 'कानपूर', name_ta: 'கான்பூர்', lgd_code: 164, lat: 26.4499, lng: 80.3319 },
  { id: 'UP-AGR', state_id: 'UP', name: 'Agra', name_hi: 'आगरा', name_mr: 'आग्रा', name_ta: 'ஆக்ரா', lgd_code: 156, lat: 27.1767, lng: 78.0081 },
  { id: 'UP-VNS', state_id: 'UP', name: 'Varanasi', name_hi: 'वाराणसी', name_mr: 'वाराणसी', name_ta: 'வாரணாசி', lgd_code: 182, lat: 25.3176, lng: 82.9739 },
  { id: 'UP-PRY', state_id: 'UP', name: 'Prayagraj', name_hi: 'प्रयागराज', name_mr: 'प्रयागराज', name_ta: 'பிரயாக்ராஜ்', lgd_code: 177, lat: 25.4358, lng: 81.8463 },
  { id: 'UP-GZB', state_id: 'UP', name: 'Ghaziabad', name_hi: 'गाज़ियाबाद', name_mr: 'गाझियाबाद', name_ta: 'காசியாபாத்', lgd_code: 151, lat: 28.6692, lng: 77.4538 },
  { id: 'UP-NOI', state_id: 'UP', name: 'Gautam Buddh Nagar', name_hi: 'गौतम बुद्ध नगर', name_mr: 'गौतम बुद्ध नगर', name_ta: 'கௌதம புத்த நகர்', lgd_code: 152, lat: 28.5355, lng: 77.391 },
  { id: 'UP-MRT', state_id: 'UP', name: 'Meerut', name_hi: 'मेरठ', name_mr: 'मेरठ', name_ta: 'மீரட்', lgd_code: 150, lat: 28.9845, lng: 77.7064 },
  { id: 'TN-CHN', state_id: 'TN', name: 'Chennai', name_hi: 'चेन्नई', name_mr: 'चेन्नई', name_ta: 'சென்னை', lgd_code: 602, lat: 13.0827, lng: 80.2707 },
  { id: 'TN-CBE', state_id: 'TN', name: 'Coimbatore', name_hi: 'कोयम्बटूर', name_mr: 'कोईम्बतूर', name_ta: 'கோயம்புத்தூர்', lgd_code: 622, lat: 11.0168, lng: 76.9558 },
  { id: 'TN-MDU', state_id: 'TN', name: 'Madurai', name_hi: 'मदुरई', name_mr: 'मदुराई', name_ta: 'மதுரை', lgd_code: 625, lat: 9.9252, lng: 78.1198 },
  { id: 'TN-TRC', state_id: 'TN', name: 'Tiruchirappalli', name_hi: 'तिरुचिरापल्ली', name_mr: 'तिरुचिरापल्ली', name_ta: 'திருச்சிராப்பள்ளி', lgd_code: 621, lat: 10.7905, lng: 78.7047 },
  { id: 'TN-SLM', state_id: 'TN', name: 'Salem', name_hi: 'सेलम', name_mr: 'सेलम', name_ta: 'சேலம்', lgd_code: 618, lat: 11.6643, lng: 78.146 },
  { id: 'TN-TVM', state_id: 'TN', name: 'तिरुनेलवेली', name_hi: 'तिरुनेलवेली', name_mr: 'तिरुनेलवेली', name_ta: 'திருநெல்வேலி', lgd_code: 630, lat: 8.7139, lng: 77.7567 },
  { id: 'TN-VLR', state_id: 'TN', name: 'Vellore', name_hi: 'वेल्लोर', name_mr: 'वेल्लोर', name_ta: 'வேலூர்', lgd_code: 609, lat: 12.9165, lng: 79.1325 },
  { id: 'TN-KNC', state_id: 'TN', name: 'Kancheepuram', name_hi: 'कांचीपुरम', name_mr: 'कांचीपुरम', name_ta: 'காஞ்சிபுரம்', lgd_code: 603, lat: 12.8342, lng: 79.7036 },
];

const sectors: Sector[] = [
  { id: 'HC', name: 'Healthcare', name_hi: 'स्वास्थ्य सेवा', name_mr: 'आरोग्य सेवा', name_ta: 'சுகாதாரம்', color: '#e74c3c' },
  { id: 'EL', name: 'Electronics & EV', name_hi: 'इलेक्ट्रॉनिक्स और ईवी', name_mr: 'इलेक्ट्रॉनिक्स आणि ईव्ही', name_ta: 'மின்னணு & மின்வாகனம்', color: '#3498db' },
  { id: 'CN', name: 'Construction', name_hi: 'निर्माण', name_mr: 'बांधकाम', name_ta: 'கட்டுமானம்', color: '#e67e22' },
  { id: 'IT', name: 'IT-ITeS', name_hi: 'आईटी-आईटीईएस', name_mr: 'आयटी-आयटीईएस', name_ta: 'ஐடி-ஐடிஇஎஸ்', color: '#9b59b6' },
];

const trades: Trade[] = [
  { id: 'HC-GDA', sector_id: 'HC', name: 'General Duty Assistant', name_hi: 'सामान्य ड्यूटी सहायक', name_ta: 'பொது பணி உதவியாளர்', nco_code: '5321', nsqf_level: 4, qp_code: 'HSS/Q5101' },
  { id: 'HC-PHT', sector_id: 'HC', name: 'Phlebotomy Technician', name_hi: 'फ्लेबोटॉमी तकनीशियन', name_ta: 'ஃபிளபோடமி தொழில்நுட்பர்', nco_code: '3212', nsqf_level: 4, qp_code: 'HSS/Q2301' },
  { id: 'HC-EMT', sector_id: 'HC', name: 'Emergency Medical Technician', name_hi: 'आपातकालीन चिकित्सा तकनीशियन', name_ta: 'அவசர மருத்துவ தொழில்நுட்பர்', nco_code: '3258', nsqf_level: 5, qp_code: 'HSS/Q0601' },
  { id: 'HC-MRI', sector_id: 'HC', name: 'Medical Records & Health IT', name_hi: 'मेडिकल रिकॉर्ड्स और हेल्थ आईटी', name_ta: 'மருத்துவ பதிவுகள் & சுகாதார ஐடி', nco_code: '3252', nsqf_level: 5, qp_code: 'HSS/Q8601' },
  { id: 'HC-HHA', sector_id: 'HC', name: 'Home Health Aide', name_hi: 'होम हेल्थ एड', name_ta: 'வீட்டு சுகாதார உதவியாளர்', nco_code: '5322', nsqf_level: 3, qp_code: 'HSS/Q5201' },
  { id: 'EL-EVT', sector_id: 'EL', name: 'EV Service Technician', name_hi: 'ईवी सर्विस तकनीशियन', name_ta: 'மின்வாகன சேவை தொழில்நுட்பர்', nco_code: '7412', nsqf_level: 4, qp_code: 'ELE/Q1201' },
  { id: 'EL-SOL', sector_id: 'EL', name: 'Solar Panel Installer', name_hi: 'सोलर पैनल इंस्टॉलर', name_ta: 'சோலார் பேனல் நிறுவுபவர்', nco_code: '7411', nsqf_level: 4, qp_code: 'ELE/Q5901' },
  { id: 'EL-PCB', sector_id: 'EL', name: 'PCB Assembly Operator', name_hi: 'पीसीबी असेंबली ऑपरेटर', name_ta: 'பிசிபி சட்டை ஆபரேட்டர்', nco_code: '8212', nsqf_level: 3, qp_code: 'ELE/Q4601' },
  { id: 'EL-IOT', sector_id: 'EL', name: 'IoT Technician', name_hi: 'आईओटी तकनीशियन', name_ta: 'ஐஓடி தொழில்நுட்பர்', nco_code: '7421', nsqf_level: 5, qp_code: 'ELE/Q6801' },
  { id: 'EL-BAT', sector_id: 'EL', name: 'Battery Technician', name_hi: 'बैटरी तकनीशियन', name_ta: 'பேட்டரி தொழில்நுட்பர்', nco_code: '7413', nsqf_level: 4, qp_code: 'ELE/Q1301' },
  { id: 'CN-MSN', sector_id: 'CN', name: 'Mason (General)', name_hi: 'राजमिस्त्री (सामान्य)', name_ta: 'கொத்தனார் (பொது)', nco_code: '7112', nsqf_level: 4, qp_code: 'CON/Q0102' },
  { id: 'CN-PLB', sector_id: 'CN', name: 'Plumber', name_hi: 'प्लंबर', name_ta: 'குழாய் பொருத்துபவர்', nco_code: '7126', nsqf_level: 4, qp_code: 'CON/Q0602' },
  { id: 'CN-BAR', sector_id: 'CN', name: 'Bar Bender & Fixer', name_hi: 'बार बेंडर एंड फिक्सर', name_ta: 'கம்பி வளைப்பவர்', nco_code: '7214', nsqf_level: 3, qp_code: 'CON/Q0203' },
  { id: 'CN-ELE', sector_id: 'CN', name: 'Construction Electrician', name_hi: 'निर्माण विद्युतकार', name_ta: 'கட்டுமான மின்சாரி', nco_code: '7411', nsqf_level: 4, qp_code: 'CON/Q0501' },
  { id: 'CN-SCF', sector_id: 'CN', name: 'Scaffolder', name_hi: 'स्कैफोल्डर', name_ta: 'சாரக்கட்டுபவர்', nco_code: '7119', nsqf_level: 3, qp_code: 'CON/Q0301' },
  { id: 'IT-DEO', sector_id: 'IT', name: 'Data Entry Operator', name_hi: 'डाटा एंट्री ऑपरेटर', name_ta: 'தரவு உள்ளீட்டு ஆபரேட்டர்', nco_code: '4132', nsqf_level: 3, qp_code: 'SSC/Q2212' },
  { id: 'IT-CCA', sector_id: 'IT', name: 'CRM Call Centre Agent', name_hi: 'सीआरएम कॉल सेंटर एजेंट', name_ta: 'சிஆர்எம் அழைப்பு மைய முகவர்', nco_code: '4222', nsqf_level: 4, qp_code: 'SSC/Q2210' },
  { id: 'IT-JWD', sector_id: 'IT', name: 'Junior Web Developer', name_hi: 'जूनियर वेब डेवलपर', name_ta: 'இளநிலை வலை உருவாக்குநர்', nco_code: '2513', nsqf_level: 5, qp_code: 'SSC/Q0503' },
  { id: 'IT-CLD', sector_id: 'IT', name: 'Cloud Computing Associate', name_hi: 'क्लाउड कंप्यूटिंग एसोसिएट', name_ta: 'கிளவுட் கம்ப்யூட்டிங் அசோசியேட்', nco_code: '2523', nsqf_level: 5, qp_code: 'SSC/Q5601' },
  { id: 'IT-AID', sector_id: 'IT', name: 'AI & Data Annotation', name_hi: 'एआई और डेटा एनोटेशन', name_ta: 'ஏஐ & தரவு சிறுகுறிப்பு', nco_code: '2511', nsqf_level: 4, qp_code: 'SSC/Q0801' },
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function getMonthLabel(monthIndex: number): string {
  const startYear = 2023; const startMonth = 10;
  const m = (startMonth + monthIndex - 1) % 12 + 1;
  const y = startYear + Math.floor((startMonth + monthIndex - 1) / 12);
  return `${y}-${String(m).padStart(2, '0')}`;
}

function getSeasonalFactor(monthIndex: number, amplitude: number): number {
  const actualMonth = (10 + monthIndex - 1) % 12;
  return amplitude * Math.cos(((actualMonth - 1) / 12) * 2 * Math.PI);
}

const tradePatterns = [
  { trade_id: 'HC-GDA', pattern: 'SHORTAGE', demandBase: 320, supplyBase: 200, demandGrowth: 0.025, supplyGrowth: 0.01, seasonality: 0.05, volatility: 0.08 },
  { trade_id: 'HC-PHT', pattern: 'SHORTAGE', demandBase: 150, supplyBase: 80, demandGrowth: 0.03, supplyGrowth: 0.008, seasonality: 0.03, volatility: 0.1 },
  { trade_id: 'HC-EMT', pattern: 'SHORTAGE', demandBase: 200, supplyBase: 90, demandGrowth: 0.035, supplyGrowth: 0.015, seasonality: 0.04, volatility: 0.07 },
  { trade_id: 'HC-MRI', pattern: 'BALANCED', demandBase: 100, supplyBase: 95, demandGrowth: 0.015, supplyGrowth: 0.014, seasonality: 0.02, volatility: 0.06 },
  { trade_id: 'HC-HHA', pattern: 'SHORTAGE', demandBase: 250, supplyBase: 120, demandGrowth: 0.04, supplyGrowth: 0.012, seasonality: 0.03, volatility: 0.09 },
  { trade_id: 'EL-EVT', pattern: 'SHORTAGE', demandBase: 180, supplyBase: 50, demandGrowth: 0.05, supplyGrowth: 0.02, seasonality: 0.02, volatility: 0.12 },
  { trade_id: 'EL-SOL', pattern: 'SHORTAGE', demandBase: 220, supplyBase: 110, demandGrowth: 0.04, supplyGrowth: 0.018, seasonality: 0.15, volatility: 0.1 },
  { trade_id: 'EL-PCB', pattern: 'BALANCED', demandBase: 140, supplyBase: 130, demandGrowth: 0.012, supplyGrowth: 0.013, seasonality: 0.05, volatility: 0.07 },
  { trade_id: 'EL-IOT', pattern: 'SHORTAGE', demandBase: 160, supplyBase: 40, demandGrowth: 0.06, supplyGrowth: 0.025, seasonality: 0.03, volatility: 0.15 },
  { trade_id: 'EL-BAT', pattern: 'SHORTAGE', demandBase: 130, supplyBase: 35, demandGrowth: 0.055, supplyGrowth: 0.02, seasonality: 0.04, volatility: 0.11 },
  { trade_id: 'CN-MSN', pattern: 'SEASONAL', demandBase: 350, supplyBase: 300, demandGrowth: 0.008, supplyGrowth: 0.01, seasonality: 0.35, volatility: 0.1 },
  { trade_id: 'CN-PLB', pattern: 'BALANCED', demandBase: 200, supplyBase: 190, demandGrowth: 0.01, supplyGrowth: 0.012, seasonality: 0.2, volatility: 0.08 },
  { trade_id: 'CN-BAR', pattern: 'SEASONAL', demandBase: 280, supplyBase: 250, demandGrowth: 0.005, supplyGrowth: 0.008, seasonality: 0.4, volatility: 0.12 },
  { trade_id: 'CN-ELE', pattern: 'BALANCED', demandBase: 180, supplyBase: 170, demandGrowth: 0.012, supplyGrowth: 0.011, seasonality: 0.15, volatility: 0.07 },
  { trade_id: 'CN-SCF', pattern: 'SEASONAL', demandBase: 150, supplyBase: 140, demandGrowth: 0.003, supplyGrowth: 0.005, seasonality: 0.3, volatility: 0.09 },
  { trade_id: 'IT-DEO', pattern: 'OVERSUPPLY', demandBase: 100, supplyBase: 350, demandGrowth: -0.01, supplyGrowth: 0.02, seasonality: 0.03, volatility: 0.06 },
  { trade_id: 'IT-CCA', pattern: 'OVERSUPPLY', demandBase: 150, supplyBase: 320, demandGrowth: -0.005, supplyGrowth: 0.015, seasonality: 0.05, volatility: 0.08 },
  { trade_id: 'IT-JWD', pattern: 'BALANCED', demandBase: 200, supplyBase: 210, demandGrowth: 0.02, supplyGrowth: 0.022, seasonality: 0.04, volatility: 0.1 },
  { trade_id: 'IT-CLD', pattern: 'SHORTAGE', demandBase: 180, supplyBase: 70, demandGrowth: 0.045, supplyGrowth: 0.02, seasonality: 0.02, volatility: 0.12 },
  { trade_id: 'IT-AID', pattern: 'SHORTAGE', demandBase: 160, supplyBase: 45, demandGrowth: 0.07, supplyGrowth: 0.03, seasonality: 0.02, volatility: 0.14 },
];

const districtScales: Record<string, number> = {
  'MH-MUM': 2.5, 'MH-PUN': 2.0, 'MH-NAG': 1.2, 'MH-NAS': 1.0,
  'MH-AUR': 0.9, 'MH-THN': 1.8, 'MH-SOL': 0.7, 'MH-KOL': 0.8,
  'UP-LKO': 1.8, 'UP-KAN': 1.3, 'UP-AGR': 1.1, 'UP-VNS': 1.0,
  'UP-PRY': 0.9, 'UP-GZB': 1.6, 'UP-NOI': 2.2, 'UP-MRT': 1.0,
  'TN-CHN': 2.8, 'TN-CBE': 1.8, 'TN-MDU': 1.1, 'TN-TRC': 0.9,
  'TN-SLM': 0.8, 'TN-TVM': 0.7, 'TN-VLR': 0.8, 'TN-KNC': 1.5,
};

async function seed() {
  console.log('🌱 Starting LMIS seed...');
  await initializeDatabase();
  const db = await getDb();
  const MONTHS = 36;
  const rng = seededRandom(42);
  let alertIdCounter = 1;

  // Clear existing data
  const tables = ['alerts', 'gap_scores', 'forecasts', 'demand_indices', 'training_capacity',
    'eshram_signals', 'industry_hiring_signals', 'job_posting_signals', 'plfs_benchmarks',
    'users', 'trades', 'sectors', 'districts', 'states'];
  for (const t of tables) {
    await db.run(`DELETE FROM ${t}`);
  }

  // Use a transaction
  await db.run('BEGIN TRANSACTION');

  try {
    for (const s of states) await db.run('INSERT INTO states VALUES (?,?,?,?,?,?,?,?)', [s.id, s.name, s.name_hi, s.name_mr, s.name_ta, s.lgd_code, s.lat, s.lng]);
    for (const d of districts) await db.run('INSERT INTO districts VALUES (?,?,?,?,?,?,?,?,?)', [d.id, d.state_id, d.name, d.name_hi, d.name_mr, d.name_ta, d.lgd_code, d.lat, d.lng]);
    for (const s of sectors) await db.run('INSERT INTO sectors VALUES (?,?,?,?,?,?)', [s.id, s.name, s.name_hi, s.name_mr, s.name_ta, s.color]);
    for (const t of trades) await db.run('INSERT INTO trades VALUES (?,?,?,?,?,?,?,?)', [t.id, t.sector_id, t.name, t.name_hi, t.name_ta, t.nco_code, t.nsqf_level, t.qp_code]);

    const users = [
      ['USR-001', 'Rajesh Kumar', 'rajesh@msde.gov.in', 'MSDE', 'mock_hash', null],
      ['USR-002', 'Priya Sharma', 'priya@ncvet.gov.in', 'NCVET', 'mock_hash', null],
      ['USR-003', 'Amit Patel', 'amit@ssc-healthcare.in', 'SSC', 'mock_hash', null],
      ['USR-004', 'Sunita Devi', 'sunita@mh-skill.gov.in', 'STATE_PLANNER', 'mock_hash', 'MH'],
      ['USR-005', 'Vijay Singh', 'vijay@up-skill.gov.in', 'STATE_PLANNER', 'mock_hash', 'UP'],
      ['USR-006', 'Lakshmi R', 'lakshmi@tn-skill.gov.in', 'STATE_PLANNER', 'mock_hash', 'TN'],
    ];
    for (const u of users) await db.run('INSERT INTO users VALUES (?,?,?,?,?,?)', u);

    for (const state of states) {
      for (const sector of sectors) {
        for (let yr = 2023; yr <= 2026; yr++) {
          const base = sector.id === 'IT' ? 0.72 : sector.id === 'HC' ? 0.68 : sector.id === 'EL' ? 0.65 : 0.60;
          await db.run('INSERT INTO plfs_benchmarks (state_id, sector_id, year, employment_rate) VALUES (?,?,?,?)', [state.id, sector.id, yr, Math.round((base + (rng() - 0.5) * 0.08 + (yr - 2023) * 0.01) * 1000) / 1000]);
        }
      }
    }

    for (const district of districts) {
      const scale = districtScales[district.id] || 1.0;
      for (const tp of tradePatterns) {
        let cumulativeDemand = 0;
        let cumulativeSupply = 0;

        for (let m = 0; m < MONTHS; m++) {
          const month = getMonthLabel(m);
          const trend = 1 + tp.demandGrowth * m;
          const supplyTrend = 1 + tp.supplyGrowth * m;
          const seasonal = getSeasonalFactor(m, tp.seasonality);
          const noise = 1 + (rng() - 0.5) * tp.volatility * 2;
          const demand = Math.max(10, Math.round(tp.demandBase * scale * trend * (1 + seasonal) * noise));
          const supplyNoise = 1 + (rng() - 0.5) * tp.volatility;
          const supply = Math.max(5, Math.round(tp.supplyBase * scale * supplyTrend * supplyNoise));
          cumulativeDemand += demand;
          cumulativeSupply += supply;

          const postings = Math.round(demand * 0.6 * (0.9 + rng() * 0.2));
          await db.run('INSERT INTO job_posting_signals (district_id, trade_id, month, postings_count, source) VALUES (?,?,?,?,?)', [district.id, tp.trade_id, month, postings, rng() > 0.5 ? 'NCS' : rng() > 0.5 ? 'naukri' : 'indeed']);
          await db.run('INSERT INTO industry_hiring_signals (district_id, trade_id, month, hires) VALUES (?,?,?,?)', [district.id, tp.trade_id, month, Math.round(demand * 0.4 * (0.85 + rng() * 0.3))]);
          await db.run('INSERT INTO eshram_signals (district_id, trade_id, month, registered_workers) VALUES (?,?,?,?)', [district.id, tp.trade_id, month, Math.round(supply * (0.7 + rng() * 0.4))]);

          const jobC = postings * 0.35;
          const hiringC = demand * 0.4 * 0.30;
          const eshramC = supply * 0.8 * 0.20;
          const plfsC = demand * 0.15;
          const idx = Math.round((jobC + hiringC + eshramC + plfsC) * 10) / 10;
          const components = JSON.stringify({ job_postings: Math.round(jobC * 10) / 10, industry_hiring: Math.round(hiringC * 10) / 10, eshram: Math.round(eshramC * 10) / 10, plfs: Math.round(plfsC * 10) / 10 });
          await db.run('INSERT INTO demand_indices (district_id, trade_id, month, index_value, components) VALUES (?,?,?,?,?)', [district.id, tp.trade_id, month, idx, components]);
        }

        for (let yr = 2023; yr <= 2026; yr++) {
          const yrFactor = 1 + tp.supplyGrowth * 12 * (yr - 2023);
          const seats = Math.round(tp.supplyBase * scale * yrFactor * 12);
          const enrolled = Math.round(seats * (0.75 + rng() * 0.2));
          const certified = Math.round(enrolled * (0.6 + rng() * 0.3));
          const placed = Math.round(certified * (0.4 + rng() * 0.35));
          await db.run('INSERT INTO training_capacity (district_id, trade_id, year, sanctioned_seats, enrolled, certified, placed, centres_count) VALUES (?,?,?,?,?,?,?,?)', [district.id, tp.trade_id, yr, seats, enrolled, certified, placed, Math.max(1, Math.round(seats / (80 + rng() * 40)))]);
        }

        for (let h = 1; h <= 12; h++) {
          const fMonth = getMonthLabel(MONTHS + h - 1);
          const dTrend = 1 + tp.demandGrowth * (MONTHS + h);
          const sTrend = 1 + tp.supplyGrowth * (MONTHS + h);
          const seasonal = getSeasonalFactor(MONTHS + h, tp.seasonality);
          const dForecast = Math.round(tp.demandBase * scale * dTrend * (1 + seasonal));
          const sForecast = Math.round(tp.supplyBase * scale * sTrend);
          const gap = dForecast - sForecast;
          const unc = Math.round(dForecast * 0.15 * Math.sqrt(h / 3));
          await db.run('INSERT INTO forecasts (district_id, trade_id, horizon_month, demand_forecast, supply_forecast, gap, lower_ci, upper_ci) VALUES (?,?,?,?,?,?,?,?)', [district.id, tp.trade_id, fMonth, dForecast, sForecast, gap, gap - unc, gap + unc]);
        }

        const avgD = cumulativeDemand / MONTHS;
        const avgS = cumulativeSupply / MONTHS;
        const ratio = avgD / Math.max(1, avgS);
        let category: string;
        let severity: number;
        if (ratio > 1.3) { category = 'SHORTAGE'; severity = Math.min(100, Math.round((ratio - 1) * 70)); }
        else if (ratio < 0.7) { category = 'OVERSUPPLY'; severity = Math.min(100, Math.round((1 / ratio - 1) * 70)); }
        else { category = 'BALANCED'; severity = Math.round(Math.abs(ratio - 1) * 50); }
        await db.run('INSERT INTO gap_scores (district_id, trade_id, severity_score, category, demand_total, supply_total) VALUES (?,?,?,?,?,?)', [district.id, tp.trade_id, severity, category, Math.round(avgD), Math.round(avgS)]);

        if (ratio > 1.5) {
          const sev = ratio > 2.5 ? 'CRITICAL' : ratio > 2 ? 'HIGH' : 'MEDIUM';
          const id = `ALT-${String(alertIdCounter++).padStart(4, '0')}`;
          await db.run('INSERT INTO alerts (id, district_id, trade_id, type, severity, reason, created_at, status) VALUES (?,?,?,?,?,?,?,?)', [id, district.id, tp.trade_id, 'ACUTE_SHORTAGE', sev, `Demand exceeds supply by ${Math.round((ratio - 1) * 100)}% in ${district.name} for ${trades.find(t => t.id === tp.trade_id)?.name}. Rising 3-month trend.`, getMonthLabel(MONTHS - 1) + '-15T00:00:00Z', rng() > 0.7 ? 'ACKNOWLEDGED' : 'ACTIVE']);
        } else if (ratio < 0.5) {
          const sev = ratio < 0.3 ? 'CRITICAL' : ratio < 0.4 ? 'HIGH' : 'MEDIUM';
          const id = `ALT-${String(alertIdCounter++).padStart(4, '0')}`;
          await db.run('INSERT INTO alerts (id, district_id, trade_id, type, severity, reason, created_at, status) VALUES (?,?,?,?,?,?,?,?)', [id, district.id, tp.trade_id, 'SATURATION', sev, `Supply exceeds demand by ${Math.round((1 / ratio - 1) * 100)}% in ${district.name} for ${trades.find(t => t.id === tp.trade_id)?.name}. Market saturation.`, getMonthLabel(MONTHS - 2) + '-10T00:00:00Z', rng() > 0.8 ? 'RESOLVED' : 'ACTIVE']);
        }
      }
    }
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }

  const count = async (table: string) => ((await db.get(`SELECT COUNT(*) as c FROM ${table}`)) as { c: number }).c;
  console.log(`\n📊 Seed Summary:`);
  console.log(`  States: ${await count('states')}`);
  console.log(`  Districts: ${await count('districts')}`);
  console.log(`  Sectors: ${await count('sectors')}`);
  console.log(`  Trades: ${await count('trades')}`);
  console.log(`  Job Postings: ${await count('job_posting_signals')}`);
  console.log(`  Hiring Signals: ${await count('industry_hiring_signals')}`);
  console.log(`  e-Shram Signals: ${await count('eshram_signals')}`);
  console.log(`  Training Capacity: ${await count('training_capacity')}`);
  console.log(`  Demand Indices: ${await count('demand_indices')}`);
  console.log(`  Forecasts: ${await count('forecasts')}`);
  console.log(`  Gap Scores: ${await count('gap_scores')}`);
  console.log(`  Alerts: ${await count('alerts')}`);
  console.log(`  Users: ${await count('users')}`);
  console.log(`\n✅ Seed complete! Database at: ${config.db.sqlitePath}`);
}

seed().catch(console.error);
