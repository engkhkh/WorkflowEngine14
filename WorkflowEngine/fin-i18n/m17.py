T = """
perm.group.hospital|Hospital|المستشفى|Hôpital|Hospital|ہسپتال|Krankenhaus|Ospedale
perm.hos.view|Open the hospital module|فتح وحدة المستشفى|Ouvrir le module hôpital|Abrir el módulo hospital|ہسپتال ماڈیول کھولیں|Krankenhausmodul öffnen|Aprire il modulo ospedale
perm.hos.patients.view|View patients|عرض المرضى|Voir les patients|Ver pacientes|مریض دیکھیں|Patienten ansehen|Vedere i pazienti
perm.hos.patients.manage|Register and edit patients|تسجيل المرضى وتعديلهم|Enregistrer et modifier les patients|Registrar y editar pacientes|مریض رجسٹر اور ایڈٹ کریں|Patienten erfassen und ändern|Registrare e modificare i pazienti
perm.hos.appointments.view|View appointments|عرض المواعيد|Voir les rendez-vous|Ver citas|اپوائنٹمنٹس دیکھیں|Termine ansehen|Vedere gli appuntamenti
perm.hos.appointments.manage|Book, check in and cancel appointments|حجز المواعيد وتسجيل الحضور وإلغاؤها|Réserver, enregistrer l'arrivée et annuler|Reservar, registrar llegada y cancelar citas|اپوائنٹمنٹ بک، چیک اِن اور منسوخ کریں|Termine buchen, einchecken und stornieren|Prenotare, accettare e annullare appuntamenti
perm.hos.clinical.view|View clinical records (visits, diagnoses)|عرض السجل الطبي (الزيارات والتشخيص)|Voir le dossier clinique (visites, diagnostics)|Ver historia clínica (visitas, diagnósticos)|کلینیکل ریکارڈ دیکھیں (وزٹ، تشخیص)|Klinische Daten ansehen (Besuche, Diagnosen)|Vedere la cartella clinica (visite, diagnosi)
perm.hos.clinical.manage|Record vitals, notes and diagnoses, close visits|تسجيل العلامات الحيوية والملاحظات والتشخيص وإغلاق الزيارات|Saisir constantes, notes et diagnostics, clôturer les visites|Registrar signos, notas y diagnósticos, cerrar visitas|علامات، نوٹس اور تشخیص درج کریں، وزٹ بند کریں|Vitalwerte, Notizen und Diagnosen erfassen, Besuche abschließen|Registrare parametri, note e diagnosi, chiudere le visite
perm.hos.prescribe|Prescribe medicines|وصف الأدوية|Prescrire des médicaments|Recetar medicamentos|ادویات تجویز کریں|Medikamente verordnen|Prescrivere farmaci
perm.hos.lab.view|View laboratory requests and results|عرض طلبات ونتائج المختبر|Voir demandes et résultats du laboratoire|Ver solicitudes y resultados de laboratorio|لیب درخواستیں اور نتائج دیکھیں|Laboraufträge und Ergebnisse ansehen|Vedere richieste e risultati di laboratorio
perm.hos.lab.order|Order laboratory tests|طلب فحوصات مخبرية|Demander des analyses|Solicitar análisis|لیب ٹیسٹ آرڈر کریں|Labortests anfordern|Richiedere esami di laboratorio
perm.hos.lab.result|Enter laboratory results|إدخال نتائج المختبر|Saisir les résultats|Introducir resultados de laboratorio|لیب نتائج درج کریں|Laborergebnisse erfassen|Inserire i risultati di laboratorio
perm.hos.pharmacy.view|View pharmacy and formulary|عرض الصيدلية والأدوية|Voir pharmacie et formulaire|Ver farmacia y formulario|فارمیسی اور فارمولری دیکھیں|Apotheke und Arzneimittelliste ansehen|Vedere farmacia e prontuario
perm.hos.pharmacy.dispense|Dispense prescriptions|صرف الوصفات الطبية|Délivrer les ordonnances|Dispensar recetas|نسخے فراہم کریں|Rezepte ausgeben|Dispensare le prescrizioni
perm.hos.pharmacy.stock|Manage medicine stock|إدارة مخزون الأدوية|Gérer le stock de médicaments|Gestionar existencias de medicamentos|ادویات کا اسٹاک سنبھالیں|Medikamentenbestand verwalten|Gestire le scorte di farmaci
perm.hos.wards.view|View wards and beds|عرض الأجنحة والأسرّة|Voir services et lits|Ver salas y camas|وارڈ اور بستر دیکھیں|Stationen und Betten ansehen|Vedere reparti e letti
perm.hos.wards.manage|Admit, transfer and discharge patients|إدخال المرضى ونقلهم وإخراجهم|Admettre, transférer et faire sortir les patients|Ingresar, trasladar y dar de alta pacientes|مریض داخل، منتقل اور فارغ کریں|Patienten aufnehmen, verlegen und entlassen|Ricoverare, trasferire e dimettere i pazienti
perm.hos.billing.view|View hospital invoices|عرض فواتير المستشفى|Voir les factures de l'hôpital|Ver facturas del hospital|ہسپتال انوائسز دیکھیں|Krankenhausrechnungen ansehen|Vedere le fatture ospedaliere
perm.hos.billing.manage|Take payments|استلام المدفوعات|Encaisser les paiements|Cobrar pagos|ادائیگیاں وصول کریں|Zahlungen entgegennehmen|Incassare i pagamenti
perm.hos.reports.view|View hospital reports|عرض تقارير المستشفى|Voir les rapports de l'hôpital|Ver informes del hospital|ہسپتال رپورٹس دیکھیں|Krankenhausberichte ansehen|Vedere i report ospedalieri
perm.hos.setup|Hospital setup (doctors, wards, price list, formulary)|إعداد المستشفى (الأطباء والأجنحة والأسعار والأدوية)|Paramétrage (médecins, services, tarifs, formulaire)|Configuración (médicos, salas, tarifas, formulario)|ہسپتال سیٹ اپ (ڈاکٹر، وارڈ، قیمتیں، ادویات)|Einrichtung (Ärzte, Stationen, Preise, Arzneimittelliste)|Impostazioni (medici, reparti, tariffe, prontuario)
hos.sub|Patients, appointments, visits, pharmacy, laboratory, wards and billing in one place.|المرضى والمواعيد والزيارات والصيدلية والمختبر والأجنحة والفواتير في مكان واحد.|Patients, rendez-vous, visites, pharmacie, laboratoire, services et facturation au même endroit.|Pacientes, citas, visitas, farmacia, laboratorio, salas y facturación en un solo lugar.|مریض، اپوائنٹمنٹس، وزٹ، فارمیسی، لیب، وارڈ اور بلنگ ایک جگہ۔|Patienten, Termine, Besuche, Apotheke, Labor, Stationen und Abrechnung an einem Ort.|Pazienti, appuntamenti, visite, farmacia, laboratorio, reparti e fatturazione in un unico posto.
hos.nav.overview|Overview|نظرة عامة|Aperçu|Resumen|جائزہ|Übersicht|Panoramica
hos.nav.patients|Patients|المرضى|Patients|Pacientes|مریض|Patienten|Pazienti
hos.nav.appointments|Appointments|المواعيد|Rendez-vous|Citas|اپوائنٹمنٹس|Termine|Appuntamenti
hos.nav.visits|Visits|الزيارات|Visites|Visitas|وزٹس|Besuche|Visite
hos.nav.lab|Laboratory|المختبر|Laboratoire|Laboratorio|لیبارٹری|Labor|Laboratorio
hos.nav.pharmacy|Pharmacy|الصيدلية|Pharmacie|Farmacia|فارمیسی|Apotheke|Farmacia
hos.nav.wards|Wards & beds|الأجنحة والأسرّة|Services et lits|Salas y camas|وارڈ اور بستر|Stationen & Betten|Reparti e letti
hos.nav.billing|Billing|الفواتير|Facturation|Facturación|بلنگ|Abrechnung|Fatturazione
hos.nav.setup|Setup|الإعداد|Paramétrage|Configuración|سیٹ اپ|Einrichtung|Impostazioni
hos.k.apptToday|Appointments today|مواعيد اليوم|Rendez-vous du jour|Citas de hoy|آج کی اپوائنٹمنٹس|Termine heute|Appuntamenti di oggi
hos.k.openVisits|Open visits|زيارات مفتوحة|Visites ouvertes|Visitas abiertas|کھلی وزٹس|Offene Besuche|Visite aperte
hos.k.admitted|Admitted patients|المرضى المنوّمون|Patients hospitalisés|Pacientes ingresados|داخل مریض|Stationäre Patienten|Pazienti ricoverati
hos.k.occupancy|Bed occupancy|إشغال الأسرّة|Occupation des lits|Ocupación de camas|بستروں کا استعمال|Bettenbelegung|Occupazione letti
hos.k.beds|beds|أسرّة|lits|camas|بستر|Betten|letti
hos.k.pendingLabs|Lab tests waiting|فحوصات بانتظار النتيجة|Analyses en attente|Análisis pendientes|زیر التواء لیب ٹیسٹ|Offene Labortests|Esami in attesa
hos.k.pendingRx|Prescriptions to dispense|وصفات بانتظار الصرف|Ordonnances à délivrer|Recetas por dispensar|فراہم کرنے والے نسخے|Rezepte auszugeben|Prescrizioni da dispensare
hos.k.revenueToday|Collected today|المحصّل اليوم|Encaissé aujourd'hui|Cobrado hoy|آج کی وصولی|Heute eingenommen|Incassato oggi
hos.k.week|7 days|7 أيام|7 jours|7 días|7 دن|7 Tage|7 giorni
hos.k.outstanding|Outstanding balance|الأرصدة المستحقة|Solde dû|Saldo pendiente|بقایا رقم|Offener Betrag|Saldo da incassare
hos.k.last7|Visits, last 7 days|الزيارات آخر 7 أيام|Visites des 7 derniers jours|Visitas de los últimos 7 días|پچھلے 7 دن کی وزٹس|Besuche der letzten 7 Tage|Visite degli ultimi 7 giorni
hos.k.topDx|Top diagnoses|أكثر التشخيصات|Principaux diagnostics|Diagnósticos principales|عام تشخیصیں|Häufigste Diagnosen|Diagnosi principali
hos.k.lowStock|Medicines at or below reorder level|أدوية وصلت حد إعادة الطلب|Médicaments au seuil de réapprovisionnement|Medicamentos en nivel de reposición|ری آرڈر لیول پر ادویات|Medikamente am Meldebestand|Farmaci sotto scorta minima
hos.searchPatient|Search by name, MRN, phone or ID…|بحث بالاسم أو الرقم الطبي أو الجوال أو الهوية…|Rechercher par nom, DMI, téléphone ou ID…|Buscar por nombre, HC, teléfono o ID…|نام، ایم آر این، فون یا آئی ڈی سے تلاش کریں…|Suche nach Name, MRN, Telefon oder ID…|Cerca per nome, MRN, telefono o ID…
hos.newPatient|New patient|مريض جديد|Nouveau patient|Nuevo paciente|نیا مریض|Neuer Patient|Nuovo paziente
hos.editPatient|Edit patient|تعديل المريض|Modifier le patient|Editar paciente|مریض ایڈٹ کریں|Patient bearbeiten|Modifica paziente
hos.none|Nothing here yet.|لا يوجد شيء بعد.|Rien pour le moment.|Todavía no hay nada.|ابھی کچھ نہیں۔|Noch nichts vorhanden.|Ancora niente.
hos.male|Male|ذكر|Homme|Hombre|مرد|Männlich|Maschio
hos.female|Female|أنثى|Femme|Mujer|عورت|Weiblich|Femmina
hos.commaSep|separate with commas|افصل بفواصل|séparer par des virgules|separar con comas|کوما سے الگ کریں|mit Komma trennen|separare con virgole
hos.back|Back|رجوع|Retour|Volver|واپس|Zurück|Indietro
hos.bookAppt|Book appointment|حجز موعد|Prendre rendez-vous|Reservar cita|اپوائنٹمنٹ بک کریں|Termin buchen|Prenota appuntamento
hos.startVisit|Start visit|بدء زيارة|Démarrer une visite|Iniciar visita|وزٹ شروع کریں|Besuch starten|Avvia visita
hos.allDoctors|All doctors|كل الأطباء|Tous les médecins|Todos los médicos|تمام ڈاکٹر|Alle Ärzte|Tutti i medici
hos.freeSlots|Free times|الأوقات المتاحة|Créneaux libres|Horarios libres|خالی اوقات|Freie Zeiten|Orari liberi
hos.checkIn|Check in|تسجيل الحضور|Enregistrer l'arrivée|Registrar llegada|چیک اِن|Einchecken|Accettazione
hos.fillRequired|Fill in the required fields.|املأ الحقول المطلوبة.|Remplissez les champs obligatoires.|Complete los campos obligatorios.|ضروری خانے پُر کریں۔|Pflichtfelder ausfüllen.|Compila i campi obbligatori.
hos.notFound|Not found.|غير موجود.|Introuvable.|No encontrado.|نہیں ملا۔|Nicht gefunden.|Non trovato.
hos.vitals|Vital signs|العلامات الحيوية|Constantes vitales|Signos vitales|اہم علامات|Vitalzeichen|Parametri vitali
hos.v.bp|Blood pressure|ضغط الدم|Tension artérielle|Presión arterial|بلڈ پریشر|Blutdruck|Pressione arteriosa
hos.v.pulse|Pulse|النبض|Pouls|Pulso|نبض|Puls|Polso
hos.v.temp|Temperature|الحرارة|Température|Temperatura|درجہ حرارت|Temperatur|Temperatura
hos.v.rr|Respiratory rate|معدل التنفس|Fréquence respiratoire|Frecuencia respiratoria|سانس کی شرح|Atemfrequenz|Frequenza respiratoria
hos.v.weight|Weight|الوزن|Poids|Peso|وزن|Gewicht|Peso
hos.v.height|Height|الطول|Taille|Altura|قد|Größe|Altezza
hos.soap.s|Subjective (history)|ذاتي (القصة المرضية)|Subjectif (anamnèse)|Subjetivo (anamnesis)|موضوعی (ہسٹری)|Subjektiv (Anamnese)|Soggettivo (anamnesi)
hos.soap.o|Objective (examination)|موضوعي (الفحص)|Objectif (examen)|Objetivo (exploración)|معروضی (معائنہ)|Objektiv (Untersuchung)|Oggettivo (esame)
hos.soap.a|Assessment|التقييم|Évaluation|Evaluación|جائزہ|Beurteilung|Valutazione
hos.soap.p|Plan|الخطة|Plan|Plan|منصوبہ|Plan|Piano
hos.add|Add|إضافة|Ajouter|Añadir|شامل کریں|Hinzufügen|Aggiungi
hos.admit|Admit|تنويم|Hospitaliser|Ingresar|داخل کریں|Aufnehmen|Ricovera
hos.closeVisit|Close visit|إغلاق الزيارة|Clôturer la visite|Cerrar visita|وزٹ بند کریں|Besuch abschließen|Chiudi visita
hos.newRx|New prescription|وصفة جديدة|Nouvelle ordonnance|Nueva receta|نیا نسخہ|Neues Rezept|Nuova prescrizione
hos.prescribe|Prescribe|وصف|Prescrire|Recetar|تجویز کریں|Verordnen|Prescrivi
hos.prescribeAnyway|Prescribe anyway|وصف رغم التحذير|Prescrire malgré l'alerte|Recetar de todos modos|پھر بھی تجویز کریں|Trotzdem verordnen|Prescrivi comunque
hos.safety|Safety warnings|تحذيرات السلامة|Alertes de sécurité|Alertas de seguridad|حفاظتی انتباہات|Sicherheitswarnungen|Avvisi di sicurezza
hos.overrideReason|Reason to prescribe anyway (kept on the record)|سبب الوصف رغم التحذير (يُحفظ في السجل)|Motif pour prescrire malgré l'alerte (conservé au dossier)|Motivo para recetar igualmente (queda en el registro)|پھر بھی تجویز کرنے کی وجہ (ریکارڈ میں رہے گی)|Grund für die Verordnung trotz Warnung (wird gespeichert)|Motivo per prescrivere comunque (resta in cartella)
hos.orderLab|Order lab tests|طلب فحوصات|Demander des analyses|Pedir análisis|لیب ٹیسٹ آرڈر کریں|Labortests anfordern|Richiedi esami
hos.urgent|Urgent|عاجل|Urgent|Urgente|فوری|Dringend|Urgente
hos.services|Services & procedures|الخدمات والإجراءات|Actes et services|Servicios y procedimientos|خدمات اور طریقہ کار|Leistungen & Eingriffe|Servizi e procedure
hos.tab.visits|Visits|الزيارات|Visites|Visitas|وزٹس|Besuche|Visite
hos.tab.appointments|Appointments|المواعيد|Rendez-vous|Citas|اپوائنٹمنٹس|Termine|Appuntamenti
hos.tab.prescriptions|Prescriptions|الوصفات|Ordonnances|Recetas|نسخے|Rezepte|Prescrizioni
hos.tab.labs|Laboratory|المختبر|Laboratoire|Laboratorio|لیبارٹری|Labor|Laboratorio
hos.tab.admissions|Admissions|التنويم|Hospitalisations|Ingresos|داخلے|Aufnahmen|Ricoveri
hos.tab.invoices|Invoices|الفواتير|Factures|Facturas|انوائسز|Rechnungen|Fatture
hos.tab.audit|Access log|سجل الوصول|Journal d'accès|Registro de accesos|رسائی لاگ|Zugriffsprotokoll|Registro accessi
hos.s.Booked|Booked|محجوز|Réservé|Reservada|بک شدہ|Gebucht|Prenotato
hos.s.CheckedIn|Checked in|حضر|Arrivé|Llegó|چیک اِن|Eingecheckt|Accettato
hos.s.Completed|Completed|مكتمل|Terminé|Completada|مکمل|Abgeschlossen|Completato
hos.s.Cancelled|Cancelled|ملغى|Annulé|Cancelada|منسوخ|Storniert|Annullato
hos.s.NoShow|No show|لم يحضر|Absent|No se presentó|غیر حاضر|Nicht erschienen|Assente
hos.s.Open|Open|مفتوحة|Ouverte|Abierta|کھلی|Offen|Aperta
hos.s.Closed|Closed|مغلقة|Clôturée|Cerrada|بند|Geschlossen|Chiusa
hos.s.Pending|Waiting|بالانتظار|En attente|Pendiente|زیر انتظار|Wartet|In attesa
hos.s.Partial|Partial|جزئي|Partiel|Parcial|جزوی|Teilweise|Parziale
hos.s.Dispensed|Dispensed|مصروفة|Délivrée|Dispensada|فراہم کر دی گئی|Ausgegeben|Dispensata
hos.s.Ordered|Ordered|مطلوب|Demandé|Solicitado|آرڈر شدہ|Angefordert|Richiesto
hos.s.Resulted|Resulted|ظهرت النتيجة|Résultat saisi|Con resultado|نتیجہ آ گیا|Ergebnis liegt vor|Refertato
hos.s.Admitted|Admitted|منوّم|Hospitalisé|Ingresado|داخل|Aufgenommen|Ricoverato
hos.s.Discharged|Discharged|خرج|Sorti|Dado de alta|فارغ|Entlassen|Dimesso
hos.s.Available|Available|متاح|Disponible|Disponible|دستیاب|Frei|Libero
hos.s.Occupied|Occupied|مشغول|Occupé|Ocupada|مصروف|Belegt|Occupato
hos.s.Maintenance|Maintenance|صيانة|Maintenance|Mantenimiento|مرمت|Wartung|Manutenzione
hos.s.Unpaid|Unpaid|غير مدفوعة|Impayée|Sin pagar|غیر ادا شدہ|Unbezahlt|Non pagata
hos.s.Paid|Paid|مدفوعة|Payée|Pagada|ادا شدہ|Bezahlt|Pagata
hos.s.Active|Active|نشط|Actif|Activo|فعال|Aktiv|Attivo
hos.s.Inactive|Inactive|غير نشط|Inactif|Inactivo|غیر فعال|Inaktiv|Inattivo
hos.s.Deceased|Deceased|متوفى|Décédé|Fallecido|وفات پا گئے|Verstorben|Deceduto
hos.f.mrn|MRN|الرقم الطبي|N° dossier|HC|ایم آر این|MRN|MRN
hos.f.name|Name|الاسم|Nom|Nombre|نام|Name|Nome
hos.f.age|Age / sex|العمر / الجنس|Âge / sexe|Edad / sexo|عمر / جنس|Alter / Geschlecht|Età / sesso
hos.f.phone|Phone|الجوال|Téléphone|Teléfono|فون|Telefon|Telefono
hos.f.allergies|Allergies|الحساسية|Allergies|Alergias|الرجی|Allergien|Allergie
hos.f.conditions|Chronic conditions|أمراض مزمنة|Maladies chroniques|Enfermedades crónicas|دائمی امراض|Chronische Erkrankungen|Patologie croniche
hos.f.insurance|Insurance|التأمين|Assurance|Seguro|انشورنس|Versicherung|Assicurazione
hos.f.sex|Sex|الجنس|Sexe|Sexo|جنس|Geschlecht|Sesso
hos.f.dob|Date of birth|تاريخ الميلاد|Date de naissance|Fecha de nacimiento|تاریخ پیدائش|Geburtsdatum|Data di nascita
hos.f.nationalId|National ID|رقم الهوية|N° d'identité|Documento de identidad|قومی شناختی نمبر|Ausweisnummer|Documento d'identità
hos.f.blood|Blood group|فصيلة الدم|Groupe sanguin|Grupo sanguíneo|بلڈ گروپ|Blutgruppe|Gruppo sanguigno
hos.f.emergency|Emergency contact|جهة اتصال الطوارئ|Contact d'urgence|Contacto de emergencia|ہنگامی رابطہ|Notfallkontakt|Contatto di emergenza
hos.f.insCompany|Insurance company|شركة التأمين|Compagnie d'assurance|Aseguradora|انشورنس کمپنی|Versicherer|Compagnia assicurativa
hos.f.policy|Policy number|رقم الوثيقة|N° de police|N.º de póliza|پالیسی نمبر|Policennummer|N. polizza
hos.f.coverage|Coverage|نسبة التغطية|Prise en charge|Cobertura|کوریج|Deckung|Copertura
hos.f.validUntil|Valid until|صالحة حتى|Valide jusqu'au|Válido hasta|تک درست|Gültig bis|Valida fino al
hos.f.code|Code|الرمز|Code|Código|کوڈ|Code|Codice
hos.f.date|Date|التاريخ|Date|Fecha|تاریخ|Datum|Data
hos.f.doctor|Doctor|الطبيب|Médecin|Médico|ڈاکٹر|Arzt|Medico
hos.f.diagnosis|Diagnosis|التشخيص|Diagnostic|Diagnóstico|تشخیص|Diagnose|Diagnosi
hos.f.status|Status|الحالة|Statut|Estado|حالت|Status|Stato
hos.f.when|When|الموعد|Quand|Cuándo|وقت|Wann|Quando
hos.f.reason|Reason|السبب|Motif|Motivo|وجہ|Grund|Motivo
hos.f.medicines|Medicines|الأدوية|Médicaments|Medicamentos|ادویات|Medikamente|Farmaci
hos.f.test|Test|الفحص|Analyse|Análisis|ٹیسٹ|Test|Esame
hos.f.result|Result|النتيجة|Résultat|Resultado|نتیجہ|Ergebnis|Risultato
hos.f.range|Reference range|المعدل الطبيعي|Valeurs usuelles|Rango de referencia|حوالہ حد|Referenzbereich|Valori di riferimento
hos.f.bed|Bed|السرير|Lit|Cama|بستر|Bett|Letto
hos.f.admitted|Admitted|تاريخ التنويم|Admission|Ingreso|داخلہ|Aufnahme|Ricovero
hos.f.discharged|Discharged|تاريخ الخروج|Sortie|Alta|فراغت|Entlassung|Dimissione
hos.f.total|Total|الإجمالي|Total|Total|کل|Gesamt|Totale
hos.f.balance|Balance|المتبقي|Solde|Saldo|بقایا|Restbetrag|Saldo
hos.f.user|User|المستخدم|Utilisateur|Usuario|صارف|Benutzer|Utente
hos.f.action|Action|الإجراء|Action|Acción|کارروائی|Aktion|Azione
hos.f.type|Type|النوع|Type|Tipo|قسم|Typ|Tipo
hos.f.complaint|Chief complaint|الشكوى الرئيسية|Motif de consultation|Motivo de consulta|بنیادی شکایت|Hauptbeschwerde|Motivo della visita
hos.f.time|Time|الوقت|Heure|Hora|وقت|Uhrzeit|Ora
hos.f.patient|Patient|المريض|Patient|Paciente|مریض|Patient|Paziente
hos.f.minutes|Minutes|الدقائق|Minutes|Minutos|منٹ|Minuten|Minuti
hos.f.dose|Dose|الجرعة|Dose|Dosis|خوراک|Dosis|Dose
hos.f.frequency|Frequency|التكرار|Fréquence|Frecuencia|تعدد|Häufigkeit|Frequenza
hos.f.days|Days|الأيام|Jours|Días|دن|Tage|Giorni
hos.f.qty|Qty|الكمية|Qté|Cant.|مقدار|Menge|Qtà
hos.f.price|Price|السعر|Prix|Precio|قیمت|Preis|Prezzo
hos.f.strength|Strength|التركيز|Dosage|Concentración|طاقت|Stärke|Dosaggio
hos.f.expiry|Expiry|الانتهاء|Péremption|Caducidad|میعاد ختم|Verfall|Scadenza
hos.f.batch|Batch|التشغيلة|Lot|Lote|بیچ|Charge|Lotto
hos.f.reorder|Reorder level|حد إعادة الطلب|Seuil de réappro.|Nivel de reposición|ری آرڈر لیول|Meldebestand|Scorta minima
hos.f.sample|Sample|العينة|Échantillon|Muestra|نمونہ|Probe|Campione
hos.f.note|Note|ملاحظة|Note|Nota|نوٹ|Notiz|Nota
hos.f.item|Item|البند|Article|Concepto|آئٹم|Position|Voce
hos.f.amount|Amount|المبلغ|Montant|Importe|رقم|Betrag|Importo
hos.f.due|Patient share|المطلوب من المريض|Part patient|A cargo del paciente|مریض کا حصہ|Patientenanteil|A carico del paziente
hos.f.paid|Paid|المدفوع|Payé|Pagado|ادا شدہ|Bezahlt|Pagato
hos.f.department|Department|القسم|Service|Departamento|شعبہ|Abteilung|Reparto
hos.f.specialty|Specialty|التخصص|Spécialité|Especialidad|تخصص|Fachgebiet|Specialità
hos.f.fee|Consultation fee|رسوم الكشف|Tarif de consultation|Tarifa de consulta|مشاورتی فیس|Honorar|Tariffa visita
hos.f.workDays|Working days|أيام العمل|Jours de travail|Días laborables|کام کے دن|Arbeitstage|Giorni di lavoro
hos.f.from|From|من|De|Desde|سے|Von|Dalle
hos.f.to|To|إلى|À|Hasta|تک|Bis|Alle
hos.f.slot|Slot (min)|مدة الموعد (د)|Créneau (min)|Franja (min)|وقفہ (منٹ)|Termin (Min.)|Slot (min)
hos.f.dailyRate|Daily rate|السعر اليومي|Tarif journalier|Tarifa diaria|یومیہ ریٹ|Tagessatz|Tariffa giornaliera
hos.f.ward|Ward|الجناح|Service|Sala|وارڈ|Station|Reparto
hos.f.category|Category|الفئة|Catégorie|Categoría|زمرہ|Kategorie|Categoria
hos.f.unit|Unit|الوحدة|Unité|Unidad|اکائی|Einheit|Unità
hos.f.low|Normal from|الحد الأدنى الطبيعي|Normale min.|Normal desde|نارمل سے|Normal ab|Normale da
hos.f.high|Normal up to|الحد الأعلى الطبيعي|Normale max.|Normal hasta|نارمل تک|Normal bis|Normale fino a
hos.f.critLow|Critical below|حرج أقل من|Critique en dessous|Crítico por debajo|اس سے کم خطرناک|Kritisch unter|Critico sotto
hos.f.critHigh|Critical above|حرج أعلى من|Critique au-dessus|Crítico por encima|اس سے زیادہ خطرناک|Kritisch über|Critico sopra
hos.f.class|Class|الصنف|Classe|Clase|کلاس|Klasse|Classe
hos.f.form|Form|الشكل|Forme|Forma|شکل|Darreichungsform|Forma
hos.f.stock|In stock|المخزون|En stock|Existencias|اسٹاک|Bestand|Giacenza
hos.f.interactsWith|Interacts with|يتداخل مع|Interagit avec|Interacciona con|اس کے ساتھ تعامل|Wechselwirkung mit|Interagisce con
hos.f.contraindications|Contraindicated in|ممنوع عند|Contre-indiqué si|Contraindicado en|ممنوع ہے|Kontraindiziert bei|Controindicato in
hos.setup.department|Departments|الأقسام|Services|Departamentos|شعبے|Abteilungen|Reparti clinici
hos.setup.doctor|Doctors|الأطباء|Médecins|Médicos|ڈاکٹر|Ärzte|Medici
hos.setup.ward|Wards|الأجنحة|Services d'hospitalisation|Salas|وارڈز|Stationen|Reparti di degenza
hos.setup.bed|Beds|الأسرّة|Lits|Camas|بستر|Betten|Letti
hos.setup.service|Price list|قائمة الأسعار|Tarifs|Tarifas|قیمتوں کی فہرست|Preisliste|Listino prezzi
hos.setup.labtest|Lab tests|فحوصات المختبر|Analyses|Análisis|لیب ٹیسٹ|Labortests|Esami di laboratorio
hos.setup.drug|Formulary|قائمة الأدوية|Formulaire|Formulario|فارمولری|Arzneimittelliste|Prontuario
hos.d.sun|Sun|الأحد|Dim|Dom|اتوار|So|Dom
hos.d.mon|Mon|الاثنين|Lun|Lun|پیر|Mo|Lun
hos.d.tue|Tue|الثلاثاء|Mar|Mar|منگل|Di|Mar
hos.d.wed|Wed|الأربعاء|Mer|Mié|بدھ|Mi|Mer
hos.d.thu|Thu|الخميس|Jeu|Jue|جمعرات|Do|Gio
hos.d.fri|Fri|الجمعة|Ven|Vie|جمعہ|Fr|Ven
hos.d.sat|Sat|السبت|Sam|Sáb|ہفتہ|Sa|Sab
hos.emptyHint|The hospital has no data yet. Load a small ready-made setup (departments, doctors, wards, price list, medicines, lab tests and three patients) or add your own below.|لا توجد بيانات بعد. حمّل إعداداً جاهزاً صغيراً (أقسام وأطباء وأجنحة وأسعار وأدوية وفحوصات وثلاثة مرضى) أو أضف بياناتك أدناه.|Aucune donnée pour l'instant. Chargez un paramétrage prêt à l'emploi (services, médecins, lits, tarifs, médicaments, analyses et trois patients) ou ajoutez les vôtres ci-dessous.|Aún no hay datos. Cargue una configuración de ejemplo (departamentos, médicos, salas, tarifas, medicamentos, análisis y tres pacientes) o añada los suyos abajo.|ابھی کوئی ڈیٹا نہیں۔ تیار نمونہ سیٹ اپ لوڈ کریں (شعبے، ڈاکٹر، وارڈ، قیمتیں، ادویات، ٹیسٹ اور تین مریض) یا نیچے اپنا شامل کریں۔|Noch keine Daten. Laden Sie eine fertige Beispieleinrichtung (Abteilungen, Ärzte, Stationen, Preise, Medikamente, Labortests und drei Patienten) oder legen Sie unten eigene an.|Nessun dato. Carica una configurazione di esempio (reparti, medici, degenze, tariffe, farmaci, esami e tre pazienti) o aggiungi i tuoi dati qui sotto.
hos.loadDemo|Load sample setup|تحميل إعداد تجريبي|Charger un exemple|Cargar configuración de ejemplo|نمونہ سیٹ اپ لوڈ کریں|Beispieldaten laden|Carica dati di esempio
hos.confirmDelete|Delete this item?|حذف هذا العنصر؟|Supprimer cet élément ?|¿Eliminar este elemento?|یہ آئٹم حذف کریں؟|Diesen Eintrag löschen?|Eliminare questa voce?
hos.close|Close|إغلاق|Fermer|Cerrar|بند کریں|Schließen|Chiudi
hos.stock|Stock|المخزون|Stock|Existencias|اسٹاک|Bestand|Magazzino
hos.adjust|Adjust|تعديل|Ajuster|Ajustar|ایڈجسٹ|Anpassen|Rettifica
hos.movements|Movements|الحركات|Mouvements|Movimientos|نقل و حرکت|Bewegungen|Movimenti
hos.dispense|Dispense|صرف|Délivrer|Dispensar|فراہم کریں|Ausgeben|Dispensa
hos.partialAsk|Dispense what is available now?|صرف المتاح حالياً؟|Délivrer ce qui est disponible ?|¿Dispensar lo disponible ahora?|جو موجود ہے وہ ابھی فراہم کریں؟|Verfügbare Menge jetzt ausgeben?|Dispensare ciò che è disponibile?
hos.enterResult|Enter result|إدخال النتيجة|Saisir le résultat|Introducir resultado|نتیجہ درج کریں|Ergebnis eingeben|Inserisci risultato
hos.amend|Amend|تعديل النتيجة|Corriger|Corregir|ترمیم|Korrigieren|Rettifica
hos.transfer|Transfer|نقل|Transférer|Trasladar|منتقل کریں|Verlegen|Trasferisci
hos.discharge|Discharge|إخراج|Sortie|Dar de alta|فارغ کریں|Entlassen|Dimetti
hos.perDay|day|يوم|jour|día|دن|Tag|giorno
hos.noWards|No wards yet. Add wards and beds in Setup.|لا توجد أجنحة بعد. أضف الأجنحة والأسرّة من الإعداد.|Aucun service. Ajoutez services et lits dans Paramétrage.|Aún no hay salas. Añada salas y camas en Configuración.|ابھی کوئی وارڈ نہیں۔ سیٹ اپ میں وارڈ اور بستر شامل کریں۔|Noch keine Stationen. Stationen und Betten in der Einrichtung anlegen.|Nessun reparto. Aggiungi reparti e letti in Impostazioni.
hos.outcome|Outcome|النتيجة النهائية|Issue|Resultado|نتیجہ|Ergebnis|Esito
hos.o.Recovered|Recovered|شُفي|Guéri|Recuperado|صحت یاب|Genesen|Guarito
hos.o.Improved|Improved|تحسّن|Amélioré|Mejorado|بہتر|Gebessert|Migliorato
hos.o.Referred|Referred|محوّل|Transféré|Derivado|ریفر کیا گیا|Überwiesen|Trasferito
hos.o.Deceased|Deceased|وفاة|Décédé|Fallecido|وفات|Verstorben|Deceduto
hos.summary|Discharge summary|ملخص الخروج|Compte rendu de sortie|Informe de alta|ڈسچارج خلاصہ|Entlassbrief|Lettera di dimissione
hos.all|All|الكل|Tous|Todos|سب|Alle|Tutti
hos.pay|Take payment|استلام الدفعة|Encaisser|Cobrar|ادائیگی وصول کریں|Zahlung buchen|Incassa
hos.m.cash|Cash|نقداً|Espèces|Efectivo|نقد|Bar|Contanti
hos.m.card|Card|بطاقة|Carte|Tarjeta|کارڈ|Karte|Carta
hos.m.transfer|Bank transfer|تحويل بنكي|Virement|Transferencia|بینک ٹرانسفر|Überweisung|Bonifico
"""
rows=[]
for l in T.strip().splitlines():
    p=l.split('|'); assert len(p)==8,(len(p),l[:50]); rows.append(p)
open('/home/claude/we/fin-i18n/table.txt','w',encoding='utf8').write("".join(" || ".join(r)+"\n" for r in rows))
print(len(rows))
