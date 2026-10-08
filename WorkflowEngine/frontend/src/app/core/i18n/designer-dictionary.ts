// Designer / workflow-engine screens: English + Arabic. Other languages: designer-extra.ts (fallback = English).
export const DESIGNER_DICTIONARY: Record<string, { en: string; ar: string }> = {
  // Sidebar / shell
  'nav.tasks': { en: 'My Tasks', ar: 'مهامي' },
  'nav.workflows': { en: 'Workflows', ar: 'سير العمل' },
  'nav.newFlow': { en: 'New Flow', ar: 'مسار جديد' },
  'nav.instances': { en: 'Instances', ar: 'الطلبات الجارية' },
  'nav.origins': { en: 'Where this came from', ar: 'مصدر التصميم' },
  'nav.signOut': { en: 'Sign out', ar: 'تسجيل الخروج' },
  'brand.name': { en: 'WorkflowEngine', ar: 'محرك سير العمل' },

  // Login
  'login.title': { en: 'Sign in to see your tasks', ar: 'سجّل الدخول لعرض مهامك' },
  'login.username': { en: 'Username', ar: 'اسم المستخدم' },
  'login.password': { en: 'Password', ar: 'كلمة المرور' },
  'login.submit': { en: 'Sign in', ar: 'تسجيل الدخول' },
  'login.submitting': { en: 'Signing in…', ar: 'جارٍ تسجيل الدخول…' },
  'login.error': { en: 'Invalid username or password.', ar: 'اسم المستخدم أو كلمة المرور غير صحيحة.' },
  'login.demoAccounts': { en: 'Demo accounts (seeded on first run):', ar: 'حسابات تجريبية (تُنشأ تلقائيًا):' },

  // Task inbox
  'tasks.title': { en: 'My Tasks', ar: 'مهامي' },
  'tasks.signedInAs': { en: 'Signed in as', ar: 'مسجّل الدخول باسم' },
  'tasks.assignedToMe': { en: 'Assigned to Me', ar: 'المسندة إليّ' },
  'tasks.myRequests': { en: 'My Requests', ar: 'طلباتي' },
  'tasks.noneAssigned': { en: 'No pending tasks for you right now.', ar: 'لا توجد مهام معلقة لك حاليًا.' },
  'tasks.selectOne': { en: 'Select a task from the list.', ar: 'اختر مهمة من القائمة.' },
  'tasks.noRequests': { en: "You haven't submitted any requests yet.", ar: 'لم تقدّم أي طلبات بعد.' },
  'tasks.escalated': { en: 'Escalated', ar: 'تمت التصعيد' },
  'tasks.comment': { en: 'Comment', ar: 'ملاحظة' },
  'tasks.commentPlaceholder': { en: 'Optional comment', ar: 'ملاحظة اختيارية (غير إلزامية)' },

  // Outcomes / statuses (used across Instances + My Requests)
  'status.pending': { en: 'Pending', ar: 'قيد الانتظار' },
  'status.completed': { en: 'Completed', ar: 'مكتمل' },
  'status.canceled': { en: 'Canceled', ar: 'ملغى' },
  'status.canceledFailed': { en: 'Canceled / Failed', ar: 'ملغى / فشل' },
  'status.approved': { en: 'Approved', ar: 'موافَق عليه' },
  'status.rejected': { en: 'Rejected', ar: 'مرفوض' },
  'status.running': { en: 'Running', ar: 'جارٍ التنفيذ' },
  'status.terminated': { en: 'Terminated', ar: 'منتهٍ' },
  'status.draft': { en: 'Draft', ar: 'مسودة' },
  'status.published': { en: 'Published', ar: 'منشور' },

  // Instances
  'instances.title': { en: 'Instances', ar: 'الطلبات الجارية' },
  'instances.subtitle': { en: 'Every workflow run, live or finished.', ar: 'كل عملية تشغيل لسير العمل، جارية كانت أو منتهية.' },
  'instances.workflow': { en: 'Workflow', ar: 'سير العمل' },
  'instances.status': { en: 'Status', ar: 'الحالة' },
  'instances.startedBy': { en: 'Started By', ar: 'بدأه' },
  'instances.started': { en: 'Started', ar: 'تاريخ البدء' },
  'instances.empty': { en: 'Nothing here yet.', ar: 'لا يوجد شيء هنا حتى الآن.' },
  'instances.cancelRequest': { en: 'Cancel Request', ar: 'إلغاء الطلب' },
  'instances.canceling': { en: 'Canceling…', ar: 'جارٍ الإلغاء…' },
  'instances.processMap': { en: 'Process Map', ar: 'خريطة العملية' },
  'instances.timeline': { en: 'Timeline', ar: 'الجدول الزمني' },
  'instances.collectedData': { en: 'Collected Data', ar: 'البيانات المجمعة' },
  'instances.backToAll': { en: '← All instances', ar: '→ جميع الطلبات' },
  'instances.noDataYet': { en: 'No data yet.', ar: 'لا توجد بيانات بعد.' },

  // Workflows / designer
  'workflows.title': { en: 'Workflows', ar: 'قوالب سير العمل' },
  'workflows.subtitle': { en: 'Templates and flows your organization can run.', ar: 'قوالب ومسارات يمكن لمؤسستك تشغيلها.' },
  'workflows.newFlow': { en: '+ New Flow', ar: '+ مسار جديد' },
  'workflows.edit': { en: 'Edit', ar: 'تعديل' },
  'workflows.start': { en: '▶ Start', ar: '▶ ابدأ' },
  'workflows.empty': { en: 'No workflows yet. Click "New Flow" to design one.', ar: 'لا توجد سير عمل بعد. اضغط "مسار جديد" لتصميم واحد.' },
  'designer.save': { en: '💾 Save', ar: '💾 حفظ' },
  'designer.publish': { en: 'Publish', ar: 'نشر' },
  'designer.testRun': { en: '▶ Test Run', ar: '▶ تشغيل تجريبي' },
  'designer.connect': { en: '🔗 Connect', ar: '🔗 ربط' },
  'designer.delete': { en: '🗑 Delete', ar: '🗑 حذف' },
  'designer.nodes': { en: 'Nodes', ar: 'العقد' },

  // Origins
  'origins.title': { en: 'Where each piece came from', ar: 'مصدر كل جزء من التصميم' },

  // Common
  'common.language': { en: 'العربية', ar: 'English' },
};
