import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Lang = 'en' | 'hi'

type Dict = Record<string, { en: string; hi: string }>

// Every user-facing string in the app lives here. Document-extracted data
// (well names, evidence text, OCR content) is source data and stays as-is.
const STR: Dict = {
  // Brand + header
  brandTitle: { en: 'NWIS', hi: 'एनडब्ल्यूआईएस' },
  brandSubtitle: { en: 'NEARBY WELLS INTELLIGENCE', hi: 'नज़दीकी कुएँ इंटेलिजेंस' },
  collapseNav: { en: 'Collapse navigation', hi: 'नेविगेशन समेटें' },
  openNav: { en: 'Open navigation', hi: 'नेविगेशन खोलें' },
  searchPhEmpty: { en: 'Search indexed document evidence…', hi: 'अनुक्रमित दस्तावेज़ साक्ष्य खोजें…' },
  searchPh: { en: 'Search {{count}} site(s) — keyword + filters…', hi: '{{count}} साइट खोजें — कीवर्ड + फ़िल्टर…' },
  clearSearch: { en: 'Clear search', hi: 'खोज साफ़ करें' },
  searchNoMatches: { en: 'No matches — try broader filters or upload more DDRs', hi: 'कोई परिणाम नहीं — व्यापक फ़िल्टर आज़माएँ या अधिक DDR अपलोड करें' },
  searchHint: { en: 'Hybrid: keyword score + formation/severity filter · Vector rank via token overlap + embedding cosine (explorer)', hi: 'हाइब्रिड: कीवर्ड स्कोर + फ़ॉर्मेशन/गंभीरता फ़िल्टर · टोकन ओवरलैप + एम्बेडिंग कोसाइन द्वारा वेक्टर रैंक (एक्सप्लोरर)' },
  processing: { en: 'PROCESSING {{progress}}%', hi: 'प्रोसेस हो रहा {{progress}}%' },
  sitesIndexed: { en: '{{count}} SITE(S) INDEXED', hi: '{{count}} साइट अनुक्रमित' },
  awaitingDoc: { en: 'AWAITING DOCUMENT', hi: 'दस्तावेज़ की प्रतीक्षा' },
  supabase: { en: 'SUPABASE', hi: 'सुपाबेस' },
  local: { en: 'LOCAL', hi: 'स्थानीय' },
  notifications: { en: 'Notifications', hi: 'सूचनाएँ' },
  settings: { en: 'Settings', hi: 'सेटिंग्स' },
  language: { en: 'Language', hi: 'भाषा' },
  switchToHi: { en: 'Switch to Hindi', hi: 'हिंदी में बदलें' },
  switchToEn: { en: 'Switch to English', hi: 'अंग्रेज़ी में बदलें' },

  // Search filter dropdowns
  fAll: { en: 'All', hi: 'सभी' },
  fSections: { en: 'Sections', hi: 'अनुभाग' },
  fEvents: { en: 'Events', hi: 'घटनाएँ' },
  fRisks: { en: 'Risks', hi: 'जोखिम' },
  fWells: { en: 'Wells', hi: 'कुएँ' },
  fAllFormations: { en: 'All formations', hi: 'सभी फ़ॉर्मेशन' },
  fAllSeverity: { en: 'All severity', hi: 'सभी गंभीरता' },

  // Sidebar
  workspace: { en: 'WORKSPACE', hi: 'कार्यक्षेत्र' },
  collapseSidebar: { en: 'Collapse sidebar', hi: 'साइडबार समेटें' },
  navCommand: { en: 'Command Center', hi: 'कमांड सेंटर' },
  navDive: { en: 'Well Dive', hi: 'वेल डाइव' },
  navDocs: { en: 'Documents', hi: 'दस्तावेज़' },
  navEmbed: { en: 'Embedding Explorer', hi: 'एम्बेडिंग एक्सप्लोरर' },
  navPredict: { en: 'Prediction Mode', hi: 'पूर्वानुमान मोड' },
  activeWell: { en: 'ACTIVE WELL', hi: 'सक्रिय कुआँ' },
  noWell: { en: 'No well indexed', hi: 'कोई कुआँ अनुक्रमित नहीं' },
  uploadDocs: { en: 'Upload drilling documents', hi: 'ड्रिलिंग दस्तावेज़ अपलोड करें' },
  sitesUnit: { en: '{{count}} site(s)', hi: '{{count}} साइट' },

  // Headings per view
  headCommand: { en: 'Operational evidence from uploaded documents.', hi: 'अपलोड किए गए दस्तावेज़ों से परिचालन साक्ष्य।' },
  headDive: { en: 'Plunge through the well — parallax strata, drill, and events.', hi: 'कुएँ में उतरें — पैरालैक्स स्तर, ड्रिल और घटनाएँ।' },
  headDocs: { en: 'Make every report searchable.', hi: 'हर रिपोर्ट खोजने योग्य बनाएँ।' },
  headEmbed: { en: 'Explore this document’s evidence.', hi: 'इस दस्तावेज़ के साक्ष्य देखें।' },
  headPredict: { en: 'Ask against indexed evidence.', hi: 'अनुक्रमित साक्ष्य से पूछें।' },

  // Empty workspace
  noData: { en: 'No operational data loaded', hi: 'कोई परिचालन डेटा लोड नहीं' },
  emptyDocs: { en: 'Upload a DDR, WCR, scan, or mud log to start OCR and factual extraction.', hi: 'OCR और तथ्यात्मक निष्कर्षण शुरू करने के लिए DDR, WCR, स्कैन या मड लॉग अपलोड करें।' },
  emptyEmbed: { en: 'Upload and index documents before exploring their text-vector relationships.', hi: 'टेक्स्ट-वेक्टर संबंध देखने से पहले दस्तावेज़ अपलोड और अनुक्रमित करें।' },
  emptyPredict: { en: 'Upload an indexed report before asking evidence-grounded questions.', hi: 'साक्ष्य-आधारित प्रश्न पूछने से पहले अनुक्रमित रिपोर्ट अपलोड करें।' },
  emptyCommand: { en: 'Upload a drilling document to populate the map, well data, events, risks, and correlations.', hi: 'मानचित्र, कुआँ डेटा, घटनाएँ, जोखिम और सहसंबंध भरने के लिए ड्रिलिंग दस्तावेज़ अपलोड करें।' },
  emptyCta1: { en: 'Use', hi: 'शुरू करने के लिए साइडबार में' },
  ingestDoc: { en: 'Ingest document', hi: 'दस्तावेज़ डालें' },
  emptyCta2: { en: 'in the sidebar to begin.', hi: 'का उपयोग करें।' },

  // Document panel / pdf viewer
  docIntel: { en: 'DOCUMENT INTELLIGENCE', hi: 'दस्तावेज़ इंटेलिजेंस' },
  indexed: { en: 'INDEXED', hi: 'अनुक्रमित' },
  regions: { en: '{{count}} REGIONS · ', hi: '{{count}} क्षेत्र · ' },
  textOcr: { en: 'TEXT OCR · ', hi: 'टेक्स्ट OCR · ' },
  pages: { en: '{{count}} PAGES', hi: '{{count}} पृष्ठ' },
  pageOf: { en: 'PAGE {{p}} OF {{n}}', hi: 'पृष्ठ {{p}} / {{n}}' },
  pageImage: { en: 'PAGE 1 OF 1 · IMAGE DOCUMENT', hi: 'पृष्ठ 1 / 1 · छवि दस्तावेज़' },
  prev: { en: '← Previous', hi: '← पिछला' },
  next: { en: 'Next →', hi: 'अगला →' },

  // Depth panel
  nameNotFound: { en: 'NAME NOT FOUND', hi: 'नाम नहीं मिला' },
  measuredDepth: { en: 'MEASURED DEPTH', hi: 'मापी गई गहराई' },
  formationNotFound: { en: 'FORMATION NOT FOUND', hi: 'फ़ॉर्मेशन नहीं मिला' },
  tvd: { en: 'TVD', hi: 'TVD' },
  progressLbl: { en: 'PROGRESS', hi: 'प्रगति' },
  avgRop: { en: 'AVG ROP', hi: 'औसत ROP' },
  mudWeight: { en: 'MUD WEIGHT', hi: 'मड वेट' },
  depthIntervalNA: { en: 'Depth interval not stated', hi: 'गहराई अंतराल नहीं दिया गया' },
  noFormations: { en: 'No formation intervals found in the document.', hi: 'दस्तावेज़ में कोई फ़ॉर्मेशन अंतराल नहीं मिला।' },
  openDive: { en: 'OPEN WELL DIVE', hi: 'वेल डाइव खोलें' },

  // Stream panel
  liveStream: { en: 'LIVE PARSING STREAM', hi: 'लाइव पार्सिंग स्ट्रीम' },
  itemsPipe: { en: '{{count}} ITEMS · DOCUMENT PIPELINE', hi: '{{count}} आइटम · दस्तावेज़ पाइपलाइन' },
  sectionIndexed: { en: 'Section indexed', hi: 'अनुभाग अनुक्रमित' },
  depthNA: { en: 'Depth not stated', hi: 'गहराई नहीं दी गई' },
  distNA: { en: 'Distance not stated', hi: 'दूरी नहीं दी गई' },
  nearbyCtx: { en: 'Nearby well context', hi: 'आस-पास के कुएँ का संदर्भ' },
  offsetW: { en: 'Offset {{id}}', hi: 'ऑफ़सेट {{id}}' },
  pdfOcr: { en: 'PDF + OCR extraction', hi: 'PDF + OCR निष्कर्षण' },
  now: { en: 'NOW', hi: 'अभी' },

  // Risk row
  docEvidence: { en: 'DOCUMENT EVIDENCE', hi: 'दस्तावेज़ साक्ष्य' },
  riskWatch: { en: 'RISK WATCH', hi: 'जोखिम निगरानी' },
  tracked: { en: '{{count}} TRACKED', hi: '{{count}} ट्रैक किए गए' },
  noDataLbl: { en: 'NO DATA', hi: 'कोई डेटा नहीं' },
  notStated: { en: 'NOT STATED', hi: 'नहीं दिया गया' },
  noRiskData: { en: 'No risk probabilities were stated or extracted.', hi: 'कोई जोखिम संभावना नहीं दी गई या निकाली गई।' },
  eventsLbl: { en: 'EVENTS ({{count}})', hi: 'घटनाएँ ({{count}})' },
  noEvents: { en: 'No events extracted', hi: 'कोई घटना नहीं निकाली गई' },
  askAboutEvents: { en: 'ASK ABOUT EVENTS', hi: 'घटनाओं के बारे में पूछें' },
  trendRising: { en: 'rising', hi: 'बढ़ता' },
  trendSteady: { en: 'steady', hi: 'स्थिर' },
  trendFalling: { en: 'falling', hi: 'घटता' },

  // Telemetry
  teleReplay: { en: 'eRTMAC TELEMETRY REPLAY', hi: 'eRTMAC टेलीमेट्री रीप्ले' },
  samplesMeta: { en: '{{count}} SAMPLES · {{depth}} · {{state}}', hi: '{{count}} नमूने · {{depth}} · {{state}}' },
  teleLive: { en: 'LIVE', hi: 'लाइव' },
  telePaused: { en: 'PAUSED', hi: 'रोका गया' },
  pause: { en: 'PAUSE', hi: 'रोकें' },
  play: { en: 'PLAY', hi: 'चलाएँ' },
  stepBack: { en: '‹ STEP', hi: '‹ चरण' },
  stepFwd: { en: 'STEP ›', hi: 'चरण ›' },
  reset: { en: 'RESET', hi: 'रीसेट' },
  speed: { en: 'SPEED', hi: 'गति' },
  csv: { en: 'CSV', hi: 'CSV' },
  teleDepth: { en: 'DEPTH', hi: 'गहराई' },
  formationWord: { en: 'formation', hi: 'फ़ॉर्मेशन' },
  alerts: { en: 'ALERTS', hi: 'अलर्ट' },
  newBadge: { en: '{{count}} NEW', hi: '{{count}} नए' },
  persistNote: { en: 'persistence {{p}} · cooldown {{c}} · hysteresis 2 normal to clear', hi: 'स्थायित्व {{p}} · कूलडाउन {{c}} · साफ़ करने के लिए 2 सामान्य हिस्टैरिसीस' },
  clearSupp: { en: 'Clear suppressed', hi: 'दबाए गए साफ़ करें' },
  noAlerts: { en: 'No alerts — replay to see persistence-gated Mud Loss / Kick / Stuck Pipe / Overpressure / Torque Spike (evidence from indexed DDR)', hi: 'कोई अलर्ट नहीं — मड लॉस / किक / स्टक पाइप / ओवरप्रेशर / टॉर्क स्पाइक देखने के लिए रीप्ले करें (अनुक्रमित DDR से साक्ष्य)' },
  ack: { en: 'Ack', hi: 'स्वीकार' },
  suppress: { en: 'Suppress', hi: 'दबाएँ' },
  escalate: { en: 'Escalate', hi: 'बढ़ाएँ' },
  kMudLoss: { en: 'Mud Loss', hi: 'मड लॉस' },
  kKick: { en: 'Kick', hi: 'किक' },
  kStuck: { en: 'Stuck Pipe', hi: 'स्टक पाइप' },
  kOver: { en: 'Overpressure', hi: 'ओवरप्रेशर' },
  kSpike: { en: 'Torque Spike', hi: 'टॉर्क स्पाइक' },
  sevHigh: { en: 'high', hi: 'उच्च' },
  sevMedium: { en: 'medium', hi: 'मध्यम' },
  sevLow: { en: 'low', hi: 'निम्न' },
  msgLoss: { en: 'Flow-out {{out}} < 88% of flow-in {{flow}} for {{n}} samples', hi: 'फ़्लो-आउट {{out}}, {{n}} नमूनों के लिए फ़्लो-इन {{flow}} का 88% से कम' },
  msgKick: { en: 'Gas {{gas}} units above kick threshold (2.8)', hi: 'गैस {{gas}} इकाई किक सीमा (2.8) से ऊपर' },
  msgStuck: { en: 'Torque {{torque}} kNm + WOB {{wob}} klb — stuck-pipe signature', hi: 'टॉर्क {{torque}} kNm + WOB {{wob}} klb — स्टक-पाइप लक्षण' },
  msgOver: { en: 'SPP {{spp}} psi sustained — overpressure', hi: 'SPP {{spp}} psi बना रहा — ओवरप्रेशर' },
  msgSpike: { en: 'Torque spike +{{d}} kNm', hi: 'टॉर्क स्पाइक +{{d}} kNm' },

  // Embedding explorer
  vecSpace: { en: 'DOCUMENT TEXT VECTOR SPACE', hi: 'दस्तावेज़ टेक्स्ट वेक्टर स्पेस' },
  noSites: { en: 'NO SITES INDEXED', hi: 'कोई साइट अनुक्रमित नहीं' },
  noSitesTitle: { en: 'No drilling sites indexed', hi: 'कोई ड्रिलिंग साइट अनुक्रमित नहीं' },
  noSitesBody: { en: 'Ingest 2+ DDRs/WCRs to see document similarity. Similar sites cluster closer.', hi: 'दस्तावेज़ समानता देखने के लिए 2+ DDR/WCR डालें। समान साइटें पास समूह बनाती हैं।' },
  modelSites1: { en: '{{model}} · 1 SITE', hi: '{{model}} · 1 साइट' },
  modelSitesN: { en: '{{model}} · {{count}} SITES', hi: '{{model}} · {{count}} साइटें' },
  formationNA2: { en: 'Formation not stated', hi: 'फ़ॉर्मेशन नहीं दिया गया' },
  uploadAnother: { en: 'Upload another document to see distance.', hi: 'दूरी देखने के लिए एक और दस्तावेज़ अपलोड करें।' },
  closest: { en: 'Closest', hi: 'सबसे निकट' },
  noCompare: { en: 'No comparison', hi: 'कोई तुलना नहीं' },
  closerNote: { en: 'CLOSER = MORE SIMILAR (COSINE)', hi: 'निकट = अधिक समान (कोसाइन)' },
  drillSites: { en: 'DRILLING SITES', hi: 'ड्रिलिंग साइटें' },
  sitesIdxMeta: { en: '{{count}} SITES INDEXED', hi: '{{count}} साइटें अनुक्रमित' },
  leaseNA: { en: 'No lease/block', hi: 'कोई लीज/ब्लॉक नहीं' },
  clickPoint: { en: 'Click a point to switch active site. Similar sites cluster closer.', hi: 'सक्रिय साइट बदलने के लिए किसी बिंदु पर क्लिक करें। समान साइटें पास समूह बनाती हैं।' },
  modelNote: { en: '{{model}} · cosine similarity · semanticProjection (PCA Gram)', hi: '{{model}} · कोसाइन समानता · सेमांटिक प्रोजेक्शन (PCA ग्राम)' },
  formationNFFull: { en: 'Formation not found', hi: 'फ़ॉर्मेशन नहीं मिला' },
  noLeaseEvents: { en: 'No operational events found.', hi: 'कोई परिचालन घटना नहीं मिली।' },
  foundMeta: { en: '{{count}} FOUND', hi: '{{count}} मिलीं' },
  extractEvents: { en: 'EXTRACTED EVENTS', hi: 'निकाली गई घटनाएँ' },

  // Dive view
  diveTitle: { en: 'WELL DIVE — PARALLAX SHAFT', hi: 'वेल डाइव — पैरालैक्स शाफ़्ट' },
  diveCtx: { en: 'DIVE CONTEXT', hi: 'डाइव संदर्भ' },
  formationsMeta: { en: '{{f}} FORMATIONS · {{e}} EVENTS', hi: '{{f}} फ़ॉर्मेशन · {{e}} घटनाएँ' },
  curFormation: { en: 'CURRENT FORMATION', hi: 'वर्तमान फ़ॉर्मेशन' },
  notFoundShort: { en: 'Not found', hi: 'नहीं मिला' },
  deepestMd: { en: 'DEEPEST MD', hi: 'अधिकतम MD' },
  mudWLbl: { en: 'MUD WEIGHT', hi: 'मड वेट' },
  depthTagged: { en: 'Depth-tagged events', hi: 'गहराई-टैग की गई घटनाएँ' },
  noDepthTagged: { en: 'No depth-tagged events in this report', hi: 'इस रिपोर्ट में कोई गहराई-टैग घटना नहीं' },
  backCommand: { en: 'Back to Command Center', hi: 'कमांड सेंटर पर वापस' },

  // Map
  docWellLoc: { en: 'DOCUMENT WELL LOCATIONS', hi: 'दस्तावेज़ कुआँ स्थान' },
  coordsNA: { en: 'COORDINATES NOT FOUND', hi: 'निर्देशांक नहीं मिले' },
  mapped: { en: '{{count}} MAPPED', hi: '{{count}} मैप किए गए' },
  noCoords: { en: 'No document coordinates found', hi: 'कोई दस्तावेज़ निर्देशांक नहीं मिला' },
  mapPopulate: { en: 'The map will populate only when latitude and longitude are present in the uploaded document.', hi: 'मानचित्र तभी भरेगा जब अपलोड किए गए दस्तावेज़ में अक्षांश और देशांतर मौजूद हों।' },
  docLocations: { en: 'DOCUMENT LOCATIONS', hi: 'दस्तावेज़ स्थान' },
  wellsWord: { en: 'WELLS', hi: 'कुएँ' },
  wellNameNA: { en: 'Well name not found', hi: 'कुएँ का नाम नहीं मिला' },
  noOffset: { en: ' · no offset wells in document', hi: ' · दस्तावेज़ में कोई ऑफ़सेट कुएँ नहीं' },
  radius: { en: 'RADIUS', hi: 'त्रिज्या' },
  formationLbl: { en: 'FORMATION', hi: 'फ़ॉर्मेशन' },
  resetBtn: { en: 'Reset', hi: 'रीसेट' },
  toggleFs: { en: 'Toggle fullscreen', hi: 'पूर्ण स्क्रीन टॉगल करें' },
  activeWellDef: { en: 'Active well', hi: 'सक्रिय कुआँ' },
  depthNoun: { en: 'Depth', hi: 'गहराई' },
  depthNotFound: { en: 'Depth not found', hi: 'गहराई नहीं मिली' },

  // Prediction / what-if
  askWhatif: { en: 'ASK NWIS · WHAT-IF SIMULATOR', hi: 'NWIS से पूछें · व्हाट-इफ़ सिम्युलेटर' },
  detLlm: { en: 'DETERMINISTIC + LLM', hi: 'नियतात्मक + LLM' },
  whatifTitle: { en: 'Transparent what-if — adjust to see risk recalc before asking LLM', hi: 'पारदर्शी व्हाट-इफ़ — LLM से पूछने से पहले जोखिम पुनर्गणना देखने के लिए समायोजित करें' },
  mudD: { en: 'MUD WEIGHT Δ', hi: 'मड वेट Δ' },
  flowD: { en: 'FLOW RATE Δ', hi: 'फ़्लो दर Δ' },
  wobD: { en: 'WOB Δ', hi: 'WOB Δ' },
  baseMw: { en: 'base {{v}}', hi: 'आधार {{v}}' },
  fromCurrent: { en: 'from current', hi: 'वर्तमान से' },
  wobBit: { en: 'weight on bit', hi: 'बिट पर वज़न' },
  resetScenario: { en: 'Reset scenario', hi: 'परिदृश्य रीसेट करें' },
  riskCol: { en: 'Risk', hi: 'जोखिम' },
  baseCol: { en: 'Base', hi: 'आधार' },
  whatifCol: { en: 'What-if', hi: 'व्हाट-इफ़' },
  deltaCol: { en: 'Δ', hi: 'Δ' },
  trendCol: { en: 'Trend', hi: 'रुझान' },
  formula: { en: 'Rule: loss +18·Δmud+0.18·Δflow · kick −22·Δmud · stuck +12·Δmud−0.12·Δflow+0.14·Δwob · clamped 5–95. LLM explains evidence, does not invent scores.', hi: 'नियम: loss +18·Δmud+0.18·Δflow · kick −22·Δmud · stuck +12·Δmud−0.12·Δflow+0.14·Δwob · 5–95 तक सीमित। LLM साक्ष्य समझाता है, स्कोर नहीं गढ़ता।' },
  noRisksWhatif: { en: 'No risks extracted — what-if will use event evidence instead. Upload a DDR with risk sections for full simulation.', hi: 'कोई जोखिम नहीं निकाला गया — व्हाट-इफ़ इसके बजाय घटना साक्ष्य का उपयोग करेगा। पूर्ण सिम्युलेशन के लिए जोखिम अनुभागों वाला DDR अपलोड करें।' },
  simBtn: { en: 'SIMULATE & EXPLAIN WITH EVIDENCE', hi: 'सिम्युलेट करें और साक्ष्य सहित समझाएँ' },
  explainBtn: { en: 'EXPLAIN BASE RISKS', hi: 'आधार जोखिम समझाएँ' },
  simulating: { en: 'SIMULATING…', hi: 'सिम्युलेट हो रहा…' },
  groqWhatif: { en: 'GROQ · WHAT-IF', hi: 'GROQ · व्हाट-इफ़' },
  groqAnalysis: { en: 'GROQ ANALYSIS', hi: 'GROQ विश्लेषण' },
  close: { en: 'Close', hi: 'बंद करें' },
  closeAnswer: { en: 'Close answer', hi: 'उत्तर बंद करें' },
  askIntro: { en: 'Ask a free-form drilling question. Constrained to uploaded evidence + what-if scores above.', hi: 'मुक्त ड्रिलिंग प्रश्न पूछें। अपलोड किए गए साक्ष्य + उपरोक्त व्हाट-इफ़ स्कोर तक सीमित।' },
  askPh: { en: 'Ask about a depth, event, formation, mud property, or operational decision…', hi: 'गहराई, घटना, फ़ॉर्मेशन, मड गुण या परिचालन निर्णय के बारे में पूछें…' },
  askBtn: { en: 'ASK NWIS', hi: 'NWIS से पूछें' },
  analysing: { en: 'ANALYSING…', hi: 'विश्लेषण हो रहा…' },

  // Status / ingest pipeline (keys, never raw English in state)
  statusInit: { en: 'No document indexed', hi: 'कोई दस्तावेज़ अनुक्रमित नहीं' },
  statusRestored: { en: 'Restored {{count}} document(s) from Supabase', hi: 'Supabase से {{count}} दस्तावेज़ पुनर्स्थापित' },
  statusOpening: { en: 'Opening {{name}}', hi: '{{name}} खोला जा रहा' },
  statusPersisted: { en: ' · persisted to Supabase', hi: ' · Supabase में सहेजा गया' },
  statusFailed: { en: 'Document processing failed', hi: 'दस्तावेज़ प्रसंस्करण विफल' },
  pgReadingPdf: { en: 'Reading page {{p}} of {{n}} with local GLM-OCR', hi: 'स्थानीय GLM-OCR से पृष्ठ {{p}} / {{n}} पढ़ा जा रहा' },
  pgExtracted: { en: 'Extracted page {{p}} of {{n}}', hi: 'पृष्ठ {{p}} / {{n}} निकाला गया' },
  pgReadingImg: { en: 'Reading page 1 with local GLM-OCR', hi: 'स्थानीय GLM-OCR से पृष्ठ 1 पढ़ा जा रहा' },
  structuring: { en: 'Sending OCR evidence to Groq for factual structuring ({{engine}})', hi: 'तथ्यात्मक संरचना के लिए OCR साक्ष्य Groq को भेजा जा रहा ({{engine}})' },
  structuringPdf: { en: 'Sending OCR evidence to Groq for factual structuring', hi: 'तथ्यात्मक संरचना के लिए OCR साक्ष्य Groq को भेजा जा रहा' },
  indexedMsg: { en: 'Indexed {{sections}} factual sections from {{pages}} pages', hi: '{{pages}} पृष्ठों से {{sections}} तथ्यात्मक अनुभाग अनुक्रमित' },
  indexedPersisted: { en: 'Indexed {{sections}} factual sections from {{pages}} pages · persisted to Supabase', hi: '{{pages}} पृष्ठों से {{sections}} तथ्यात्मक अनुभाग अनुक्रमित · Supabase में सहेजा गया' },
  docFailedWith: { en: '{{name}}: {{err}}', hi: '{{name}}: {{err}}' },

  // Errors (thrown as language keys, rendered in current lang)
  errOcrBad: { en: 'OCR service returned an invalid response. Check that the API server is running.', hi: 'OCR सेवा ने अमान्य प्रतिक्रिया दी। जाँचें कि API सर्वर चल रहा है।' },
  errOcrFail: { en: 'Local GLM-OCR processing failed.', hi: 'स्थानीय GLM-OCR प्रसंस्करण विफल।' },
  errNoTextImg: { en: 'No readable text was found in this image.', hi: 'इस छवि में कोई पठनीय टेक्स्ट नहीं मिला।' },
  errCanvas: { en: 'Canvas not available for document OCR.', hi: 'दस्तावेज़ OCR के लिए कैनवास उपलब्ध नहीं।' },
  errImgLoad: { en: 'Failed to load image for OCR.', hi: 'OCR के लिए छवि लोड विफल।' },
  errNoTextPdf: { en: 'No readable text was found in this document.', hi: 'इस दस्तावेज़ में कोई पठनीय टेक्स्ट नहीं मिला।' },
  errStruct: { en: 'Document analysis failed.', hi: 'दस्तावेज़ विश्लेषण विफल।' },
  errTiff: { en: 'Convert TIFF files to PDF or PNG before uploading.', hi: 'अपलोड से पहले TIFF फ़ाइलों को PDF या PNG में बदलें।' },
  errType: { en: 'Select a PDF, PNG, JPEG, WebP or BMP file.', hi: 'PDF, PNG, JPEG, WebP या BMP फ़ाइल चुनें।' },
  errCsvHeader: { en: 'CSV needs header + rows', hi: 'CSV में हेडर + पंक्तियाँ आवश्यक' },
  errCsvDepth: { en: 'CSV header must include depth or md', hi: 'CSV हेडर में depth या md होना चाहिए' },
  errCsv: { en: 'CSV parse failed', hi: 'CSV पार्स विफल' },
  errAsk: { en: 'Ask NWIS failed.', hi: 'NWIS से पूछना विफल।' },
  errWhatifNoRisks: { en: 'No risks were extracted from this document to simulate. Upload a DDR with risk or event evidence.', hi: 'सिम्युलेट करने के लिए इस दस्तावेज़ से कोई जोखिम नहीं निकाला गया। जोखिम या घटना साक्ष्य वाला DDR अपलोड करें।' },
  errWhatif: { en: 'What-if simulation failed.', hi: 'व्हाट-इफ़ सिम्युलेशन विफल।' },

  simHazard: { en: 'Similar hazard noted in {{f}} offset wells', hi: '{{f}} ऑफ़सेट कुओं में समान खतरा दर्ज' },
  noOffsetEv: { en: 'No direct offset evidence', hi: 'कोई प्रत्यक्ष ऑफ़सेट साक्ष्य नहीं' },
  unitKm: { en: ' km', hi: ' किमी' },
  qa: { en: 'QUICK ACTIONS', hi: 'त्वरित क्रियाएँ' },
  uploadTitle: { en: 'Select a PDF or image drilling report', hi: 'PDF या छवि ड्रिलिंग रिपोर्ट चुनें' },
  ingestDocs: { en: 'Ingest document(s)', hi: 'दस्तावेज़ डालें' },
  askNwisSb: { en: 'Ask NWIS', hi: 'NWIS से पूछें' },
  indexReady: { en: 'Index ready', hi: 'इंडेक्स तैयार' },
  noDataset: { en: 'No dataset loaded', hi: 'कोई डेटासेट लोड नहीं' },
  noDocCaps: { en: 'NO DOCUMENT', hi: 'कोई दस्तावेज़ नहीं' },
  eyebrowField: { en: 'FIELD OVERVIEW', hi: 'फ़ील्ड अवलोकन' },
  eyebrowGraph: { en: 'EVIDENCE GRAPH', hi: 'साक्ष्य ग्राफ़' },
  eyebrowDecision: { en: 'DECISION SUPPORT', hi: 'निर्णय सहायता' },
  dateNA: { en: 'DATE NOT FOUND', hi: 'तिथि नहीं मिली' },
  procDoc: { en: 'Processing document', hi: 'दस्तावेज़ प्रोसेस हो रहा' },
  procStages: { en: 'Document processing stages', hi: 'दस्तावेज़ प्रसंस्करण चरण' },
  procNote: { en: 'Progress follows completed stages. OCR may take several minutes per page.', hi: 'प्रगति पूर्ण चरणों का अनुसरण करती है। OCR में प्रति पृष्ठ कई मिनट लग सकते हैं।' },
  dropIngest: { en: 'Drop DDRs / WCRs to ingest (multi)', hi: 'डालने के लिए DDR / WCR छोड़ें (एकाधिक)' },
  indexedFrom: { en: 'INDEXED FROM UPLOADED DOCUMENT', hi: 'अपलोड किए गए दस्तावेज़ से अनुक्रमित' },
  awaitingUp: { en: 'AWAITING UPLOAD', hi: 'अपलोड की प्रतीक्षा' },
  noDocIdx: { en: 'No document indexed', hi: 'कोई दस्तावेज़ अनुक्रमित नहीं' },
  footerStats: { en: '{{s}} sections · {{e}} events · {{v}} vectors', hi: '{{s}} अनुभाग · {{e}} घटनाएँ · {{v}} वेक्टर' },
  hits: { en: '{{count}} hits', hi: '{{count}} परिणाम' },
  qGood: { en: 'good', hi: 'अच्छा' },
  qDegraded: { en: 'degraded', hi: 'घटिया' },
  qMissing: { en: 'missing', hi: 'अनुपलब्ध' },
  secsWord: { en: 'sections', hi: 'अनुभाग' },
  evtsWord: { en: 'events', hi: 'घटनाएँ' },
  // Generic + units
  notFound: { en: 'Not found', hi: 'नहीं मिला' },
  unitM: { en: ' m', hi: ' मी' },
  unitRop: { en: ' m/h', hi: ' मी/घं' },
  dangerNow: { en: 'NOW', hi: 'अभी' },

  // WellDive
  wdLive: { en: 'LIVE DEPTH MODEL', hi: 'लाइव गहराई मॉडल' },
  wdOpenFull: { en: 'Open full dive', hi: 'पूर्ण डाइव खोलें' },
  wdAuto: { en: 'Auto dive', hi: 'ऑटो डाइव' },
  wdPause: { en: 'Pause', hi: 'रोकें' },
  wdPauseAuto: { en: 'Pause automatic dive', hi: 'स्वचालित डाइव रोकें' },
  wdStartAuto: { en: 'Start automatic dive', hi: 'स्वचालित डाइव शुरू करें' },
  wdActive: { en: 'ACTIVE INTERVAL', hi: 'सक्रिय अंतराल' },
  wdFormationNA: { en: 'Formation not identified', hi: 'फ़ॉर्मेशन की पहचान नहीं' },
  wdInspect: { en: 'Move the depth control to inspect formation and event evidence.', hi: 'फ़ॉर्मेशन और घटना साक्ष्य देखने के लिए गहराई नियंत्रण घुमाएँ।' },
  wdEventFb: { en: 'EVENT', hi: 'घटना' },
  wdShallow: { en: 'SHALLOW', hi: 'उथला' },
  wdDeep: { en: 'DEEP', hi: 'गहरा' },
  wdInspectDepth: { en: 'Inspect well depth', hi: 'कुएँ की गहराई देखें' },
  wdTaggedOne: { en: '{{count}} depth-tagged event · MD from uploaded report', hi: '{{count}} गहराई-टैग घटना · अपलोड की गई रिपोर्ट से MD' },
  wdTaggedMany: { en: '{{count}} depth-tagged events · MD from uploaded report', hi: '{{count}} गहराई-टैग घटनाएँ · अपलोड की गई रिपोर्ट से MD' },
  wdDiveAria: { en: 'Interactive well section to {{depth}} metres', hi: '{{depth}} मीटर तक इंटरैक्टिव कुआँ खंड' },
  wdMetres: { en: '{{depth}} m', hi: '{{depth}} मी' },
}

export type StrKey = keyof typeof STR

const ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (key: StrKey, vars?: Record<string, string | number>) => string }>({
  lang: 'en',
  setLang: () => undefined,
  t: (key) => STR[key]?.en ?? key,
})

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('nwis-lang')
    if (saved === 'hi' || saved === 'en') return saved
    if ((navigator.language || '').toLowerCase().startsWith('hi')) return 'hi'
  } catch { /* */ }
  return 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem('nwis-lang', l) } catch { /* */ }
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  const t = useCallback((key: StrKey, vars?: Record<string, string | number>) => {
    const entry = STR[key]
    if (!entry) return key
    let s = lang === 'hi' ? entry.hi : entry.en
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(String(v))
    return s
  }, [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <ctx.Provider value={value}>{children}</ctx.Provider>
}

export function useLang() {
  return useContext(ctx)
}

// Stable English text for backend persistence (Supabase), independent of UI language.
export function enText(key: StrKey, vars?: Record<string, string | number>) {
  const entry = STR[key]
  if (!entry) return key
  let s = entry.en
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(String(v))
  return s
}
