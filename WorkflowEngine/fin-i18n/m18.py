T = """
hos.setup.setting|General|عام|Général|General|عمومی|Allgemein|Generale
hos.f.hospitalName|Hospital name|اسم المستشفى|Nom de l'hôpital|Nombre del hospital|ہسپتال کا نام|Name des Krankenhauses|Nome dell'ospedale
hos.f.currency|Currency|العملة|Devise|Moneda|کرنسی|Währung|Valuta
hos.f.taxName|Tax name (VAT, GST, ...)|اسم الضريبة (قيمة مضافة ...)|Nom de la taxe (TVA, ...)|Nombre del impuesto (IVA, ...)|ٹیکس کا نام (وی اے ٹی وغیرہ)|Steuerbezeichnung (MwSt., ...)|Nome dell'imposta (IVA, ...)
hos.f.taxPct|Tax rate %|نسبة الضريبة %|Taux de taxe %|Tasa de impuesto %|ٹیکس کی شرح %|Steuersatz %|Aliquota %
hos.f.taxExempt|Tax-exempt items (consult, service, lab, drug, bed)|بنود معفاة من الضريبة (كشف، خدمة، مختبر، دواء، سرير)|Lignes exonérées (consult, service, lab, drug, bed)|Conceptos exentos (consult, service, lab, drug, bed)|ٹیکس سے مستثنیٰ مدات (consult, service, lab, drug, bed)|Steuerfreie Positionen (consult, service, lab, drug, bed)|Voci esenti (consult, service, lab, drug, bed)
hos.f.payMethods|Payment methods|طرق الدفع|Moyens de paiement|Métodos de pago|ادائیگی کے طریقے|Zahlungsarten|Metodi di pagamento
hos.f.weekend|Weekend days|أيام العطلة الأسبوعية|Jours de week-end|Días de fin de semana|ہفتہ وار چھٹی کے دن|Wochenendtage|Giorni di fine settimana
hos.f.subtotal|Subtotal|المجموع الفرعي|Sous-total|Subtotal|ذیلی کل|Zwischensumme|Subtotale
hos.f.tax|Tax|الضريبة|Taxe|Impuesto|ٹیکس|Steuer|Imposta
hos.m.other|Other|أخرى|Autre|Otro|دیگر|Sonstige|Altro
hos.f.nationalId|ID / passport number|رقم الهوية / الجواز|N° d'identité / passeport|N.º de documento / pasaporte|شناختی / پاسپورٹ نمبر|Ausweis- / Passnummer|N. documento / passaporto
"""
rows=[l.split('|') for l in T.strip().splitlines()]
for r in rows: assert len(r)==8,r[0]
open('/home/claude/we/fin-i18n/table.txt','w',encoding='utf8').write("".join(" || ".join(r)+"\n" for r in rows))
