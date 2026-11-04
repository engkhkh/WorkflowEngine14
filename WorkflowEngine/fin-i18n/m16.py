T = """
module.workflow|Workflow designer|مصمم سير العمل|Concepteur de workflows|Diseñador de flujos|ورک فلو ڈیزائنر|Workflow-Designer|Progettista di flussi
module.hospital|Hospital|المستشفى|Hôpital|Hospital|ہسپتال|Krankenhaus|Ospedale
perm.group.workflow|Workflow designer|مصمم سير العمل|Concepteur de workflows|Diseñador de flujos|ورک فلو ڈیزائنر|Workflow-Designer|Progettista di flussi
perm.wf.view|View workflows|عرض سير العمل|Voir les workflows|Ver flujos|ورک فلو دیکھیں|Workflows ansehen|Vedere i flussi
perm.wf.design|Design workflows|تصميم سير العمل|Concevoir les workflows|Diseñar flujos|ورک فلو ڈیزائن کریں|Workflows entwerfen|Progettare i flussi
perm.wf.publish|Publish and delete workflows|نشر سير العمل وحذفه|Publier et supprimer les workflows|Publicar y eliminar flujos|ورک فلو شائع اور حذف کریں|Workflows veröffentlichen und löschen|Pubblicare ed eliminare i flussi
perm.wf.instances.view|Run and follow workflow instances|تشغيل ومتابعة حالات سير العمل|Lancer et suivre les instances|Ejecutar y seguir instancias|ورک فلو انسٹینس چلائیں اور دیکھیں|Instanzen starten und verfolgen|Avviare e seguire le istanze
workflows.template|Template|قالب|Modèle|Plantilla|ٹیمپلیٹ|Vorlage|Modello
workflows.duplicate|Duplicate to my workflows|نسخ إلى سير عملي|Dupliquer dans mes workflows|Duplicar a mis flujos|میرے ورک فلو میں نقل کریں|In meine Workflows kopieren|Duplica nei miei flussi
mods.tab|Modules|الوحدات|Modules|Módulos|ماڈیولز|Module|Moduli
mods.hint|Choose the modules your company uses. Users only get privileges for modules that are switched on, and the others disappear from the menu.|اختر الوحدات التي تستخدمها شركتك. يحصل المستخدمون على صلاحيات الوحدات المفعّلة فقط وتختفي الأخرى من القائمة.|Choisissez les modules utilisés par votre entreprise. Les utilisateurs n'ont des droits que pour les modules activés, les autres disparaissent du menu.|Elija los módulos que usa su empresa. Los usuarios solo reciben privilegios de los módulos activados y los demás desaparecen del menú.|وہ ماڈیولز منتخب کریں جو آپ کی کمپنی استعمال کرتی ہے۔ صارفین کو صرف فعال ماڈیولز کے اختیارات ملتے ہیں اور باقی مینو سے غائب ہو جاتے ہیں۔|Wählen Sie die Module Ihres Unternehmens. Benutzer erhalten nur Rechte für aktivierte Module, die übrigen verschwinden aus dem Menü.|Scegli i moduli usati dalla tua azienda. Gli utenti ottengono privilegi solo per i moduli attivi, gli altri spariscono dal menu.
mods.all|Select all|تحديد الكل|Tout sélectionner|Seleccionar todo|سب منتخب کریں|Alle auswählen|Seleziona tutto
mods.none|Clear all|إلغاء الكل|Tout désélectionner|Quitar todo|سب ہٹائیں|Alle abwählen|Deseleziona tutto
"""
rows=[]
for l in T.strip().splitlines():
    p=l.split('|'); assert len(p)==8,(len(p),l[:40]); rows.append(p)
open('/home/claude/we/fin-i18n/table.txt','w',encoding='utf8').write("".join(" || ".join(r)+"\n" for r in rows))
print(len(rows))
