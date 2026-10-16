export interface LandingQuery {
  slug: string;
  q: string;
  a: string;
  section: string;
}

const S = (slug: string, q: string, a: string, section: string): LandingQuery => ({
  slug,
  q,
  a,
  section,
});

// 100 long-tail queries grounded in shipped copy (no diagnosis, no prescriptions).
// Sections match App anchors: home, features, capabilities, app, why, pricing, faq.
export const QUERIES: LandingQuery[] = [
  // Camera pulse / face pulse / HRV (1-15)
  S('camera-pulse-heart-rate-no-watch', 'How can I measure heart rate with my phone camera and no watch?', 'Put your fingertip on the lens for 60 seconds. HealthGraph reads tiny skin-color shifts (PPG) on-device and gives heart rate plus HRV. No watch, no strap. See #capabilities.', 'capabilities'),
  S('face-pulse-selfie-video', 'Can a selfie video really measure my pulse?', 'Yes. Prop the phone up, look at it for about 30 seconds. The face-pulse lens reads the same skin-color signal from your face, on-device, frames never stored. See #capabilities.', 'capabilities'),
  S('hrv-baseline-morning-evening', 'How do I build a personal HRV baseline?', 'Take morning and evening readings for a few weeks. HealthGraph trends them so the readiness lens learns what is normal for you. See #capabilities.', 'capabilities'),
  S('ppg-vs-hospital-clip', 'Is phone PPG the same idea hospitals use?', 'The same photoplethysmography principle, minus the finger clip. Phone readings are wellness trends, not medical measurements. See #faq.', 'faq'),
  S('pulse-offline-airplane', 'Does pulse check work offline?', 'Yes. Camera and face pulse compute on your phone, and the 3D body ships inside the app, so airplane mode still works. See #capabilities.', 'capabilities'),
  S('best-time-pulse-reading', 'When should I take a pulse reading?', 'Most people do morning and evening: morning shows recovery, evening while dinner cooks shows the day. The Day rhythm uses 19:22 for the 60-second check. See #app.', 'app'),
  S('pulse-accuracy-tips-shaky-hands', 'Why do my pulse readings fail when my hands shake?', 'Motion breaks the skin-color signal. Rest the phone on a table, hold still, use good light. Failed quality reads are discarded, never filed as fact. See #faq.', 'faq'),
  S('resting-pulse-trend-training', 'How do I watch resting pulse drop across a training block?', 'Log readings daily, then scroll Trends & timeline for months. You will see the drift across the block instead of one noisy day. See #capabilities.', 'capabilities'),
  S('hrv-without-subscription', 'Can I get HRV without a subscription wearable?', 'Yes. Fingertip on the lens gives heart rate plus HRV with no watch and no subscription. The phone in your pocket is the wearable. See #capabilities.', 'capabilities'),
  S('face-pulse-frames-stored', 'Are my face-pulse video frames stored anywhere?', 'No. Every frame is analyzed on your device and never stored. Your face never uploads anywhere. See #capabilities.', 'capabilities'),
  S('pulse-for-older-parents', 'Can my older parent use pulse check with no tech skills?', 'Yes. One 60-second fingertip hold, or a 30-second look at the phone. No pairing, no charging, no wearable. See #how.', 'how'),
  S('pulse-before-doctor-visit', 'What pulse history should I show my doctor?', 'Show the 7-day trend and morning/evening notes from your timeline. It is a clearer mirror for the visit, not a diagnosis. See #capabilities.', 'capabilities'),
  S('camera-pulse-good-light', 'Does camera pulse need good light?', 'Fingertip needs the flash-lit lens seal; face pulse needs decent front light. The quality meter tells you live whether the signal counts. See #capabilities.', 'capabilities'),
  S('pulse-vs-smartwatch-choice', 'Phone pulse vs smartwatch: which should I use?', 'Wearables are welcome guests, never requirements. If you own one, keep it; if not, the camera covers heart rate and HRV for free. See #faq.', 'faq'),
  S('pulse-data-where-stored', 'Where do my pulse readings live?', 'On your phone first, in your health graph. The cloud is only a backup you control. Export or delete any time. See #why.', 'why'),

  // Sleep & recovery (16-25)
  S('sleep-log-bedtime-waketime', 'How do I log sleep in under ten seconds?', 'Bedtime, wake time, naps, quality notes: four quick taps. The engine pairs nights with next-day energy until your formula appears. See #capabilities.', 'capabilities'),
  S('why-tired-five-short-nights', 'Why am I tired? Can my own data answer?', 'Ask Sanotts AI in plain words. It answers from your logs with receipts, e.g. your last five short nights, and says so when data is missing. See #capabilities.', 'capabilities'),
  S('which-bedtime-buys-good-morning', 'Which bedtime actually buys me a good morning?', 'The sleep engine pairs your nights with energy until your personal formula appears, instead of generic 8-hour advice. See #capabilities.', 'capabilities'),
  S('naps-track-recovery', 'Should I log naps or only nights?', 'Log both. Nights, naps, bedtimes and wake times all feed recovery, so short nights plus naps tell the full story. See #capabilities.', 'capabilities'),
  S('short-nights-heavy-days-pattern', 'Do short nights cluster before heavy days?', 'The graph shows it plainly: short nights cluster before heavy days, so tomorrow you protect the evening. That is the whole trick. See #app.', 'app'),
  S('sleep-without-wearable', 'Can I track sleep with no wearable?', 'Yes. Manual bed/wake logging plus next-day energy is enough for the sleep lens. No ring or watch required. See #faq.', 'faq'),
  S('sleep-timeline-months', 'How far back can I scroll my sleep?', 'Months. Trends & timeline is longitudinal, so habits compound visibly or you spot the week everything slipped. See #capabilities.', 'capabilities'),
  S('evenings-buy-mornings', 'Which evenings buy good mornings?', 'The app pairs each evening with the next morning until the pattern is obvious. See which evenings pay and which charge interest. See #capabilities.', 'capabilities'),
  S('sleep-energy-correlation', 'Does my sleep explain my mornings?', 'That is the core join: nights explain mornings, meals explain afternoons. Everything sits side by side for the first time. See #why.', 'why'),
  S('sleep-notes-quality', 'What sleep notes are worth writing?', 'Bedtime, wake time, quality, plus one line on the evening. Sixty seconds at 22:47 beats a perfect diary you quit. See #app.', 'app'),

  // Medications / reminders / family watch (26-37)
  S('medication-schedule-dose-logging', 'How do I set up a medication schedule?', 'Define each medicine once with dose, times and days. The day view reduces to one decision per row: taken or not. See #capabilities.', 'capabilities'),
  S('missed-dose-family-notify', 'What happens when I miss a linked dose?', 'You tap once and your SMS app opens with the message ready for the family member you invited. Nothing is ever sent automatically. See #faq.', 'faq'),
  S('refill-aware-reminders', 'How do refill-aware reminders work?', 'The app counts your supply down and reminds before you run out, so refills stop being surprises. See #capabilities.', 'capabilities'),
  S('snooze-with-reason', 'Can I snooze a med reminder with a reason?', 'Yes. Snooze with a reason and the graph learns the difference between forgot and chose. See #capabilities.', 'capabilities'),
  S('midday-dose-work-routine', 'How do people remember the midday dose at work?', 'A spoken alarm asks, you answer taken, it logs with a timestamp. No unlocking, no typing, no I will log it later. See #app.', 'app'),
  S('family-watch-which-meds', 'Which medications should family watch?', 'Pick only the doses that matter most, invite someone you trust, and choose which meds they see. Your tap is consent every time. See #faq.', 'faq'),
  S('meds-explain-flat-weeks', 'Can missed meds explain flat weeks?', 'Yes. Meds explain the flat weeks because everything is in the same place: doses sit next to sleep, meals and mood. See #why.', 'why'),
  S('medication-timeline-export-doctor', 'How do I show my medication adherence to my doctor?', 'Every taken dose lands timestamped in the graph. Export the timeline in open formats in seconds, ready for the visit. See #capabilities.', 'capabilities'),
  S('multiple-meds-daily-log', 'How do I log multiple meds a day fast?', 'One tap per row stamps the time. Three screens, one graph, sixty seconds at a time. See #how.', 'how'),
  S('voice-alarm-midday-dose', 'What does a voice medication alarm sound like?', 'It talks and listens: Did you take the midday dose? Answer taken and it is logged. See #capabilities.', 'capabilities'),
  S('med-adherence-spoke', 'Is adherence really a health signal?', 'Yes. The dose spoke joins sleep, heart, meals and mood, so skipped weeks show where they belong. See #capabilities.', 'capabilities'),
  S('meds-offline-no-signal', 'Do med reminders work with no signal?', 'Logging, meds and timeline work offline and sync quietly when you reconnect. Anything needing network says so. See #faq.', 'faq'),

  // Food & barcode (38-47)
  S('barcode-scan-macros-free-db', 'How does barcode scanning get macros for free?', 'The database is Open Food Facts: free, open, two million products. First scan downloads macros; repeats work with zero bars. See #capabilities.', 'capabilities'),
  S('supermarket-basement-no-signal', 'Can I scan food with no signal in the supermarket?', 'Yes. Your most-scanned products live on your phone, so repeat scans work offline in the basement. See #capabilities.', 'capabilities'),
  S('oats-breakfast-one-scan', 'How fast is breakfast logging really?', 'Breakfast barcode, one scan. Oats, again. Your phone remembers the product. No signal needed, no typing. See #app.', 'app'),
  S('meals-explain-afternoons', 'Do meals really explain afternoons?', 'That is the join: meals explain afternoons the way nights explain mornings. Heavy lunch, flat afternoon, visible. See #why.', 'why'),
  S('food-scan-vs-calorie-counter-app', 'Why replace my calorie counter with barcode scan?', 'Ten apps, ten logins, ten subscriptions, none knowing the others. One scan feeds the same graph as sleep and meds. See #why.', 'why'),
  S('weight-nutrition-engine', 'How do nutrition and weight lenses use food logs?', 'The weight and nutrition engines watch meals plus scale entries and turn them into one clear next step, not a dashboard of dials. See #capabilities.', 'capabilities'),
  S('log-eating-out-no-barcode', 'How do I log food with no barcode when eating out?', 'Ten-second manual tap: what you ate and how you felt. Whatever costs least effort wins. See #how.', 'how'),
  S('food-history-months', 'Can I see what I ate three months ago?', 'Yes. Every entry lands timestamped, scrollable for months, so the snacking-start week is findable. See #capabilities.', 'capabilities'),
  S('meal-scans-free-limit', 'How many meal scans does Free include?', 'Free includes 3 meal scans a month plus 2 AI messages. Daily logging, meds and timeline stay free. See #pricing.', 'pricing'),
  S('unlimited-food-scans-tier', 'Which tier unlocks unlimited food scans?', 'General unlocks unlimited food scans plus camera pulse and the full graph. All-in adds everything else. See #pricing.', 'pricing'),

  // Medical documents (48-55)
  S('scan-lab-report-search', 'How do I scan a lab report and find it later?', 'Photograph lab PDFs and prescriptions. They are text-searched and filed by date, like email for your health. See #capabilities.', 'capabilities'),
  S('cholesterol-march-number', 'What was my cholesterol in March?', 'Ask and get the number, not a folder to dig through. Documents are extracted into your timeline with originals one tap away. See #capabilities.', 'capabilities'),
  S('prescription-photo-filing', 'Where do prescriptions live after I photograph them?', 'Filed by date, searchable, encrypted at rest, wiped on logout. Your filing cabinet, minus the cabinet. See #capabilities.', 'capabilities'),
  S('document-scans-free-vs-paid', 'How many document scans do I get?', 'Free covers daily logging; General adds 4 document scans a month; All-in is unlimited. See #pricing.', 'pricing'),
  S('discharge-papers-organize', 'How do I organize discharge papers?', 'Photograph, text-search, file by date. Ask what matters and get the value with the paper attached. See #capabilities.', 'capabilities'),
  S('documents-encrypted-logout-wipe', 'Are my scanned documents encrypted?', 'Yes. Cached files are encrypted at rest and wiped the moment you log out. See #why.', 'why'),
  S('export-documents-doctor', 'Can I export documents for my doctor?', 'Yes. Values plus originals export in open formats in seconds, ready to show. See #capabilities.', 'capabilities'),
  S('paper-records-to-graph', 'How do paper records join my graph?', 'Photographed pages become timestamped values in the same timeline as sleep, meds and meals. See #capabilities.', 'capabilities'),

  // Cycle & substance (56-63)
  S('cycle-tracking-fertile-window', 'Does cycle tracking include fertile-window planning?', 'Yes, with TTC and pregnancy modes plus perimenopause notes. Private, unjudged, exportable. See #capabilities.', 'capabilities'),
  S('ttc-pregnancy-modes', 'What are TTC and pregnancy modes?', 'Planning modes inside cycle tracking that adapt the lens when you are trying to conceive or pregnant. See #capabilities.', 'capabilities'),
  S('perimenopause-notes', 'Can I keep perimenopause notes?', 'Yes. Cycle tracking includes perimenopause notes alongside period history, all exportable. See #capabilities.', 'capabilities'),
  S('substance-log-pledge', 'How do substance logs with pledges work?', 'Log use, set a pledge, watch a money-saved counter grow. Judgment-free by design. See #capabilities.', 'capabilities'),
  S('money-saved-counter-alcohol', 'Is there a money-saved counter when I cut back?', 'Yes. Substance logs carry pledges and a running money-saved total. See #capabilities.', 'capabilities'),
  S('cycle-mood-sleep-join', 'Does cycle data join sleep and mood?', 'Yes. Cycle, sleep, meds, meals and mood land in one graph, so heavy Tuesdays stop hiding. See #capabilities.', 'capabilities'),
  S('private-period-tracker', 'Is this period tracker really private?', 'On-device first, encrypted cache wiped on logout, never sold, export or delete in one tap. See #why.', 'why'),
  S('replace-period-tracker-app', 'Can this replace my period tracker app?', 'It replaces ten apps at once: period, sleep, meds, meals and more feed one graph instead of ten logins. See #why.', 'why'),

  // Voice calls & alarms (64-71)
  S('voice-checkin-call-morning', 'What is the daily voice check-in call?', 'One scheduled call a day. The voice asks, you answer, the timeline fills: sleep, meds, mood, symptoms. See #capabilities.', 'capabilities'),
  S('voice-call-missed-twice', 'What if I miss the voice check-in call?', 'It tries once more; ignore it twice and it leaves you alone. No nagging. See #capabilities.', 'capabilities'),
  S('handsfree-logging-kettle', 'Can I log hands-free while the kettle boils?', 'Yes. Talk for a minute while the kettle boils; your timeline fills itself in. See #capabilities.', 'capabilities'),
  S('voice-alarm-vs-phone-alarm', 'How is a voice alarm different from a phone alarm?', 'It talks and listens. Say what you took, ate or felt and it logs with a timestamp. No typing. See #capabilities.', 'capabilities'),
  S('voice-features-which-tier', 'Which tier includes voice alarms and calls?', 'All-in. General keeps camera pulse and graph; All-in adds voice alarms, call reminders, 3D body and unlimited AI. See #pricing.', 'pricing'),
  S('alarm-speak-half-asleep', 'Can I answer the alarm half-asleep?', 'Yes. Your 07:12 alarm speaks, you answer slept badly, shoulder aches, logged before feet touch floor. See #app.', 'app'),
  S('voice-log-symptoms', 'Can I log symptoms by voice?', 'Yes. Say what you felt and it lands timestamped with meds, sleep and mood. See #capabilities.', 'capabilities'),
  S('missed-call-no-spam', 'Will the voice system spam me with calls?', 'No. One call a day, one retry, then it leaves you alone. See #capabilities.', 'capabilities'),

  // 3D body (72-78)
  S('3d-body-tap-chest-heart', 'What happens when I tap my chest in 3D body?', 'Tap a zone and the graph answers with your data for it. Chest shows your heart data. See #capabilities.', 'capabilities'),
  S('3d-body-offline-model', 'Does 3D body need downloads or internet?', 'No. Male and female shells with seven organ meshes ship inside the app. Works in airplane mode. See #capabilities.', 'capabilities'),
  S('3d-body-male-female', 'Are there male and female body models?', 'Yes. Both shells with seven organ meshes, generated by this project, no licenses. See #capabilities.', 'capabilities'),
  S('3d-body-which-tier', 'Which tier includes the 3D body?', 'All-in includes the 3D body. General stops before it. See #pricing.', 'pricing'),
  S('anatomy-zones-organs', 'What zones and organs are included?', 'Zones plus organs, both included, wired straight to your graph. See #capabilities.', 'capabilities'),
  S('tap-zone-see-data', 'Can I tap a body zone to see my history there?', 'Yes. Tap a zone and the graph answers with your data for that place. See #capabilities.', 'capabilities'),
  S('3d-body-airplane-mode', 'Does anatomy work in airplane mode?', 'Yes. The model ships inside the app, so zones work with zero bars. See #capabilities.', 'capabilities'),

  // Privacy / rights (79-86)
  S('data-where-live-phone-first', 'Where does my health data live?', 'On your phone first. Camera and face pulse never leave it; cached files are encrypted and wiped on logout. See #faq.', 'faq'),
  S('export-delete-one-tap-gdpr', 'Can I export or delete everything in one tap?', 'Yes. One tap exports in open formats; one tap deletes. DSGVO-compliant, no dark patterns. See #capabilities.', 'capabilities'),
  S('health-data-sold', 'Is my health data ever sold?', 'Never. It never leaves your hands in the first place, so there is nothing to sell. See #why.', 'why'),
  S('logout-wipe-cache', 'What happens to cached files when I log out?', 'Encrypted cached files are wiped the moment you log out. Lose your phone and history does not go with it. See #why.', 'why'),
  S('sanotts-ai-sees-what', 'What can Sanotts AI see?', 'Only your data. It cannot browse, cannot guess, cannot flatter. If data does not support an answer, it says so. See #capabilities.', 'capabilities'),
  S('family-watch-consent', 'Does family watch send messages automatically?', 'Never automatic. Your tap opens SMS with the message ready; your tap is consent every time. See #faq.', 'faq'),
  S('is-medical-device', 'Is HealthGraph a medical device?', 'No. A wellness companion, a clearer mirror, not a doctor. It never diagnoses, stages or treats. See #faq.', 'faq'),
  S('dsgvo-gdpr-compliant', 'Is HealthGraph DSGVO/GDPR compliant?', 'Yes. Export and deletion in one tap, encrypted at rest, never sold. See #why.', 'why'),

  // Pricing / free (87-92)
  S('free-forever-what-included', 'What does Free actually include?', 'Daily logging and check-ins, medications with dose tracking, timeline, 3 meal scans and 2 AI messages a month. Free means free. See #pricing.', 'pricing'),
  S('general-11-euro-worth', 'What do I get for General at 11 euros?', 'Everything in Free unlimited, camera pulse, health graph, priority engines, 4 document scans a month, unlimited food scans. See #pricing.', 'pricing'),
  S('all-in-18-euro-worth', 'What do I get for All-in at 18 euros?', 'Everything in General plus face pulse, 3D body, voice alarms and call reminders, unlimited AI and documents. See #pricing.', 'pricing'),
  S('start-free-keep-free', 'Can I start free and stay free?', 'Yes. Start free and stay free as long as you like. Upgrade only when advanced lenses earn it. See #pricing.', 'pricing'),
  S('no-wearable-needed-cost', 'Do I need to buy a wearable?', 'No. Fingertip plus selfie video cover heart rate and HRV. Wearables welcome, never required. See #faq.', 'faq'),
  S('early-access-invite-how-long', 'How do I get early access and how long does it take?', 'Leave name, email and city. We email your invite with the free trial, usually within days. See #early-access.', 'early-access'),

  // Compare / why one graph (93-100)
  S('replace-ten-health-apps', 'Can one app really replace ten health apps?', 'Sixteen capabilities, one graph. Sleep explains mornings, meals explain afternoons, meds explain flat weeks. See #why.', 'why'),
  S('ten-subscriptions-cost-chaos', 'How much do ten health subscriptions cost?', 'The graveyard counts $48.93 a month for chaos. HealthGraph starts at 0 euros with one graph. See #why.', 'why'),
  S('how-it-works-three-moves', 'How does HealthGraph work in three moves?', 'Measure in sixty seconds, connect everything in one graph, act on one clear next step. See #how.', 'how'),
  S('seven-priority-engines-next-step', 'What are the seven priority engines?', 'Heart, sleep, fitness, nutrition, weight, wellbeing, discipline. Each turns raw logs into one clear next step. See #capabilities.', 'capabilities'),
  S('day-with-healthgraph-rhythm', 'What does a day with HealthGraph feel like?', 'Not a dashboard you admire. A rhythm you barely notice: 07:12 voice, 08:05 scan, 13:40 dose, 19:22 pulse, 22:47 review. See #app.', 'app'),
  S('health-connected-story', 'Why is health a connected story?', 'Reports, prescriptions, fitness, sleep and food live apart, but your health is not fragmented, your records are. One graph fixes that. See #about.', 'about'),
  S('android-english-german-early-access', 'Which phones and languages are supported?', 'Early access runs on Android, in English and German. Your invite email tells you what to install. See #faq.', 'faq'),
  S('get-early-access-free-trial', 'How do I start my free early access?', 'Leave name, email and city at #early-access. We email your invite with the free trial. Free to start, free to keep.', 'early-access'),
];
