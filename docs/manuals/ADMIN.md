# Administrator guide / Mwongozo wa msimamizi

For the Super Admin and the Head Teacher. Menu names are the same as on screen. *Maelezo ya Kiswahili yako chini ya ukurasa huu (sehemu ya 2).*

## 1. English

### First week: set up in this order
1. **Sign in** with the one-off password you were given and set your own (a long phrase you can remember). Never share it.
2. **School settings** (Settings): school name, motto, contact details, time zone (Africa/Dar_es_Salaam), default language.
3. **Academics → Academic setup**: create the **academic year** and its **terms**; mark the current ones. Add **levels** (for example O-Level, A-Level), **classes** and **streams**, and the **subjects** each class takes.
4. **Assign teachers** (same page): a *class teacher* per class/stream and *subject teachers* per class/stream and subject. This decides what each teacher can see and do (attendance, marks, homework, behaviour). A teacher with no assignment sees nothing.
5. **Users** → create staff accounts and give each person the matching **role** (Head Teacher, Class Teacher, Subject Teacher, Accountant, Registrar). **Roles** shows exactly what each role may do; you can only give what you hold yourself. Give the temporary password privately; people must change it at first sign-in.
6. **Grading**: enter the school's own grade bands, pass mark and division rules. The system has no built-in national bands — check the first report cards against the school's official policy.
7. **Students**: add students one by one or import a CSV (Excel → "Save as CSV UTF-8"). Every student needs at least one guardian and one primary guardian. Check for duplicates when the system asks.
8. **Finance → Fee items and structures**, then **Invoices → generate term invoices** (preview first). See the accountant guide.
9. **Timetable → Lesson periods**, then build each class timetable (the system refuses a teacher, class or room in two places at once).
10. **Website**: text, photos, news and events appear on the public site only when published. Only the school's own, approved pictures should be used.
11. **Parent and student accounts**: open a student → create the parent's portal account (and the student's, if wanted). Give each temporary password to the family privately.

### Every day or week
- **Dashboard**: the *Needs attention* list (unmatched payments, refunds waiting, marks to approve, messages waiting, backups).
- **Marks**: approve submitted mark sheets; lock when final. Unlocking needs a reason and is recorded.
- **Planning**: review teachers' schemes of work and lesson plans (approve or return with a note).
- **Communication**: send notices and fee reminders (the preview shows exactly who receives what; SMS is recorded as *skipped* until an SMS provider is connected).
- **Audit**: who did what and when. Nothing here can be edited.

### Every term
- Create new terms; **Marks → Examinations**; lock results; generate and **publish report cards** (parents see only published cards).
- Generate **term invoices**; check **arrears**.
- Archive nothing by deleting: students are withdrawn/transferred/graduated with a reason, history is kept.

### Backups (Super Admin)
**Settings → Backups** shows the newest backup and the last restore test. It must say *Backups are current*. If it does not, follow `docs/DEPLOYMENT.md` section 5. A backup that was never restored is not proven: do the monthly restore test.

### Rules that protect the school
- Nothing is ever deleted to "fix" a number: invoices, payments, marks, behaviour records and audit entries are corrected by a reversal/void with a reason.
- Staff see only what their role allows. Do not give a role more than the job needs.
- A payment is only *paid* when money is recorded; an invoice existing or being zero never means paid.

## 2. Kiswahili

### Wiki ya kwanza: panga kwa mpangilio huu
1. **Ingia** kwa nenosiri la mara moja ulilopewa, kisha weka lako (sentensi ndefu unayoikumbuka). Usimpe mtu yeyote.
2. **Mipangilio ya shule**: jina, kauli mbiu, mawasiliano, saa za eneo (Africa/Dar_es_Salaam), lugha ya msingi.
3. **Taaluma → Mpangilio wa taaluma**: tengeneza **mwaka wa masomo** na **mihula**; weka wa sasa. Ongeza **ngazi** (mfano O-Level, A-Level), **madarasa**, **mikondo** na **masomo** ya kila darasa.
4. **Wapange walimu** (ukurasa huo huo): *mwalimu wa darasa* kwa kila darasa/mkondo na *walimu wa masomo*. Hii huamua kila mwalimu anaona na kufanya nini (mahudhurio, alama, kazi za nyumbani, tabia). Mwalimu asiyepangiwa haoni chochote.
5. **Wafanyakazi na watumiaji**: tengeneza akaunti na mpe kila mtu **jukumu** linalofaa (Mwalimu Mkuu, Mwalimu wa Darasa, Mwalimu wa Somo, Mhasibu, Msajili). **Majukumu na ruhusa** inaonyesha kila jukumu linaruhusu nini; unaweza kutoa ulichonacho wewe tu. Mpe nenosiri la muda faraghani; ni lazima libadilishwe wakati wa kwanza kuingia.
6. **Madaraja**: weka madaraja ya shule yenyewe, alama ya kufaulu na kanuni za divisheni. Mfumo hauna madaraja ya kitaifa yaliyojengwa ndani — linganisha ripoti za kwanza na sera rasmi ya shule.
7. **Wanafunzi**: ongeza mmoja mmoja au pakia CSV (Excel → "Save as CSV UTF-8"). Kila mwanafunzi anahitaji angalau mlezi mmoja na mlezi mkuu mmoja. Angalia nakala mbili mfumo unapouliza.
8. **Fedha → Vipengele na miundo ya ada**, kisha **Ankara → tengeneza ankara za muhula** (tazama kwanza). Soma mwongozo wa mhasibu.
9. **Ratiba → Vipindi vya siku**, kisha jenga ratiba ya kila darasa (mfumo unakataa mwalimu, darasa au chumba kuwa mahali pawili kwa wakati mmoja).
10. **Tovuti**: maandishi, picha, habari na matukio huonekana kwenye tovuti ya umma yakichapishwa tu. Tumia picha zilizoidhinishwa na shule pekee.
11. **Akaunti za wazazi na wanafunzi**: fungua mwanafunzi → tengeneza akaunti ya mzazi (na ya mwanafunzi ukitaka). Mpe kila familia nenosiri la muda faraghani.

### Kila siku au wiki
- **Muhtasari**: orodha ya *Yanayohitaji umakini* (malipo yasiyolingana, marejesho yanayosubiri, alama za kuidhinisha, ujumbe, nakala za akiba).
- **Alama**: idhinisha mafaili ya alama yaliyowasilishwa; funga yakiwa ya mwisho. Kufungua kunahitaji sababu na hurekodiwa.
- **Mipango ya kufundisha**: pitia maandalio ya walimu (idhinisha au rudisha kwa ujumbe).
- **Mawasiliano**: tuma taarifa na vikumbusho vya ada (hakiki inaonyesha nani anapokea nini; SMS huandikwa *imerukwa* hadi mtoa huduma wa SMS aunganishwe).
- **Kumbukumbu za ukaguzi**: nani alifanya nini na lini. Hakuna kinachoweza kuhaririwa.

### Kila muhula
- Tengeneza mihula mipya; **Alama → Mitihani**; funga matokeo; tengeneza na **chapisha ripoti za maendeleo** (wazazi huona zilizochapishwa tu).
- Tengeneza **ankara za muhula**; kagua **madeni**.
- Usifute ili "kurekebisha": wanafunzi huondolewa/huhamishwa/huhitimu kwa sababu, historia hubaki.

### Nakala za akiba (Msimamizi Mkuu)
**Mipangilio ya shule → Nakala za akiba** inaonyesha nakala mpya zaidi na jaribio la mwisho la kurejesha. Lazima iseme *Nakala za akiba ziko sawa*. Isipokuwa hivyo, fuata `docs/DEPLOYMENT.md` sehemu ya 5. Nakala ambayo haijawahi kurejeshwa haijathibitishwa: fanya jaribio la kurejesha kila mwezi.

### Kanuni zinazoilinda shule
- Hakuna kinachofutwa ili kurekebisha namba: ankara, malipo, alama, kumbukumbu za tabia na za ukaguzi hurekebishwa kwa kutengua/kubatilisha kwa sababu.
- Wafanyakazi huona tu kile jukumu lao linaruhusu. Usimpe mtu zaidi ya kazi inavyohitaji.
- Malipo ni *yamelipwa* pale tu pesa imerekodiwa; ankara kuwepo au kuwa sifuri hakumaanishi imelipwa.
