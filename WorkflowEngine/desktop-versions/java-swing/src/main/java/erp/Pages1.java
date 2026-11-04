package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Dialog;
import java.awt.FlowLayout;
import java.awt.GridLayout;
import java.awt.Window;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.IntConsumer;
import java.util.regex.Pattern;
import javax.swing.BorderFactory;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JComboBox;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JTextArea;
import javax.swing.JButton;

/** Home, approvals and documents. */
final class Pages1 {
    private Pages1() { }

    // ----------------------------------------------------------------- home
    static final class HomePanel extends JPanel implements Reloadable {
        private final JLabel hello = Ui.label("", "title");
        private final JLabel tasks = new JLabel("–"), appr = new JLabel("–"), docs = new JLabel("–");

        HomePanel(IntConsumer goPage, java.util.function.BiConsumer<String, String> openKind) {
            super(new BorderLayout());
            JPanel body = new JPanel();
            body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
            body.setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            body.add(hello);
            body.add(Box.createVerticalStrut(10));
            JPanel cards = new JPanel(new GridLayout(1, 3, 12, 0));
            cards.add(card(tasks, t("home.pendingTasks"), () -> goPage.accept(1)));
            cards.add(card(appr, t("home.pendingApprovals"), () -> goPage.accept(1)));
            cards.add(card(docs, t("home.myDocs"), () -> goPage.accept(2)));
            cards.setMaximumSize(new java.awt.Dimension(Integer.MAX_VALUE, 110));
            body.add(cards);
            body.add(Box.createVerticalStrut(16));
            body.add(Ui.label(t("home.modules"), "title"));
            JPanel grid = new JPanel(new GridLayout(0, 4, 8, 8));
            for (Map<String, Object> m : I18n.visibleModules())
                grid.add(Ui.button(I18n.name(m), () -> openKind.accept(Json.str(m.get("id")), null), "ghost"));
            JPanel wrap = new JPanel(new BorderLayout());
            wrap.setOpaque(false);
            wrap.add(grid, BorderLayout.NORTH);
            body.add(wrap);
            add(body, BorderLayout.NORTH);
        }

        private JPanel card(JLabel big, String small, Runnable click) {
            JPanel p = new JPanel(new BorderLayout());
            p.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(new java.awt.Color(0xE2E8F0)), BorderFactory.createEmptyBorder(10, 14, 10, 14)));
            p.setBackground(java.awt.Color.WHITE);
            big.setFont(big.getFont().deriveFont(java.awt.Font.BOLD, 30f));
            big.setForeground(Ui.PRIMARY);
            p.add(big, BorderLayout.CENTER);
            p.add(Ui.label(small, "dim"), BorderLayout.SOUTH);
            p.setCursor(java.awt.Cursor.getPredefinedCursor(java.awt.Cursor.HAND_CURSOR));
            p.addMouseListener(new java.awt.event.MouseAdapter() { @Override public void mouseClicked(java.awt.event.MouseEvent e) { click.run(); } });
            return p;
        }

        @Override public void reload() {
            hello.setText("<html>" + t("home.hello", "name", Api.I.displayName) + "</html>");
            Ui.async(() -> {
                int tk = safe(Api.I::tasks).size();
                int ap = 0;
                if (Api.I.can("gov.view"))
                    for (Map<String, Object> a : safe(() -> Api.I.records("gov", "approval")))
                        if ("Pending".equals(a.get("status")) && Boolean.TRUE.equals(Json.obj(a.get("data")).get("canAct"))) ap++;
                return new int[]{tk, ap, safe(Api.I::instances).size()};
            }, r -> { tasks.setText("" + r[0]); appr.setText("" + r[1]); docs.setText("" + r[2]); }, null);
        }

        private static List<Map<String, Object>> safe(java.util.function.Supplier<List<Map<String, Object>>> s) {
            try { return s.get(); } catch (RuntimeException e) { return new ArrayList<>(); }
        }
    }

    // ----------------------------------------------------------------- approvals
    static final class ApprovalsPanel extends JPanel implements Reloadable {
        private final Ui.DataTable table = new Ui.DataTable(t("appr.type"), t("appr.target"), t("appr.requestedBy"), t("erp.status"));
        private final JLabel empty = Ui.label(t("appr.none"), "dim");

        ApprovalsPanel() {
            super(new BorderLayout());
            table.onOpen(this::open);
            JPanel bar = Ui.row(Ui.button(t("common.refresh"), this::reload, "ghost"));
            JPanel p = Ui.page(t("tab.approvals"), bar, Ui.scroll(table), empty);
            add(p);
        }

        @Override public void reload() {
            Ui.async(() -> {
                List<Object[]> out = new ArrayList<>();
                for (Map<String, Object> x : Api.I.tasks()) out.add(new Object[]{"wf", x});
                if (Api.I.can("gov.view"))
                    for (Map<String, Object> a : Api.I.records("gov", "approval")) if ("Pending".equals(a.get("status"))) out.add(new Object[]{"erp", a});
                return out;
            }, items -> {
                List<String[]> rows = new ArrayList<>();
                for (Object[] it : items) {
                    Map<String, Object> m = Json.obj(it[1]);
                    if ("wf".equals(it[0])) rows.add(new String[]{t("appr.workflow"), Json.str(m.get("nodeName")), m.get("priority") == null ? "Normal" : Json.str(m.get("priority")), "Pending"});
                    else {
                        Map<String, Object> d = Json.obj(m.get("data"));
                        rows.add(new String[]{t("appr.erp"), Json.str(d.get("target")) + " " + (d.get("code") != null ? Json.str(d.get("code")) : Json.str(m.get("code"))),
                                d.get("requestedBy") != null ? Json.str(d.get("requestedBy")) : Json.str(m.get("createdBy")), Json.str(m.get("status"))});
                    }
                }
                table.fill(rows, items);
                empty.setVisible(rows.isEmpty());
            }, m -> Ui.warn(this, m));
        }

        private void open() {
            Object[] sel = (Object[]) table.selected();
            if (sel == null) return;
            if (new ApprovalDialog(this, "wf".equals(sel[0]) ? Json.obj(sel[1]) : null, "erp".equals(sel[0]) ? Json.obj(sel[1]) : null).showAndResult()) reload();
        }
    }

    static final class ApprovalDialog extends JDialog {
        private boolean done;
        private final JTextArea comment = new JTextArea(3, 30);
        private final JLabel err = Ui.label("", "error");
        private final List<JButton> buttons = new ArrayList<>();
        private Forms.TypedForm form;

        ApprovalDialog(java.awt.Component parent, Map<String, Object> task, Map<String, Object> appr) {
            super((Window) javax.swing.SwingUtilities.getWindowAncestor(parent), "", Dialog.ModalityType.APPLICATION_MODAL);
            Map<String, Object> d = appr == null ? new LinkedHashMap<>() : Json.obj(appr.get("data"));
            String title = task != null ? Json.str(task.get("nodeName")) : Json.str(d.get("target")) + " " + (d.get("code") != null ? Json.str(d.get("code")) : Json.str(appr.get("code")));
            setTitle(title);
            JPanel body = new JPanel();
            body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
            body.setBorder(BorderFactory.createEmptyBorder(14, 16, 14, 16));
            body.add(Ui.label(title, "title"));
            boolean can = true;
            if (appr != null) {
                body.add(Ui.label(t("appr.amount") + ": " + (d.get("amount") == null ? "-" : Json.str(d.get("amount"))), null));
                body.add(Ui.label(t("appr.requestedBy") + ": " + (d.get("requestedBy") != null ? Json.str(d.get("requestedBy")) : Json.str(appr.get("createdBy"))), null));
                can = !Boolean.FALSE.equals(d.get("canAct"));
                if (!can) body.add(Ui.label(t("appr.cantAct"), "error"));
            }
            if (task != null && !Json.arr(Json.obj(task.get("form")).get("fields")).isEmpty()) {
                form = new Forms.TypedForm(Json.obj(task.get("form")));
                String ft = Json.str(Json.obj(task.get("form")).get("title"));
                if (!ft.isEmpty()) body.add(Ui.label(ft, "dim"));
                body.add(form);
                // pre-fill the step's form from the data already collected on this document
                Forms.TypedForm fm = form;
                Ui.async(() -> Api.I.instance(Json.str(task.get("instanceId"))), i -> fm.setValues(Json.obj(i.get("data"))), m -> { });
            }
            body.add(Box.createVerticalStrut(8));
            body.add(Ui.label(t("appr.comment"), "dim"));
            body.add(Ui.scroll(comment));
            body.add(err);
            JPanel row = new JPanel(new FlowLayout(FlowLayout.LEADING));
            if (task != null) {
                for (Object dec : Json.arr(task.get("availableDecisions"))) {
                    String ds = String.valueOf(dec);
                    boolean bad = Pattern.compile("reject|deny|decline", Pattern.CASE_INSENSITIVE).matcher(ds).find();
                    JButton b = Ui.button(ds, () -> act(task, null, ds), bad ? "danger" : null);
                    buttons.add(b); row.add(b);
                }
            } else {
                JButton a = Ui.button(t("appr.approve"), () -> act(null, appr, "approve"), null);
                JButton r = Ui.button(t("appr.reject"), () -> act(null, appr, "reject"), "danger");
                a.setEnabled(can); r.setEnabled(can);
                buttons.add(a); buttons.add(r); row.add(a); row.add(r);
            }
            row.add(Ui.button(t("common.cancel"), this::dispose, "ghost"));
            body.add(row);
            setContentPane(body);
            pack();
            setMinimumSize(new java.awt.Dimension(440, 0));
            setLocationRelativeTo(parent);
        }

        private void act(Map<String, Object> task, Map<String, Object> appr, String decision) {
            String text = comment.getText();
            err.setText("");
            Map<String, Object> formData = null;
            if (form != null) {
                if (!Forms.isNegative(decision) && form.missing()) { err.setText(t("tasks.missing")); return; }
                formData = form.values();
            }
            Map<String, Object> fd = formData;
            buttons.forEach(b -> b.setEnabled(false));
            Ui.async(() -> {
                if (task != null) Api.I.completeTask(Json.str(task.get("id")), decision, text, fd);
                else Api.I.approvalAct(Json.str(appr.get("id")), "reject".equals(decision) ? "reject" : "approve", text);
                return Boolean.TRUE;
            }, r -> { done = true; dispose(); }, m -> { err.setText("<html>" + m + "</html>"); buttons.forEach(b -> b.setEnabled(true)); });
        }

        boolean showAndResult() { setVisible(true); return done; }
    }

    // ----------------------------------------------------------------- documents
    static final class DocumentsPanel extends JPanel implements Reloadable {
        private final Ui.DataTable table = new Ui.DataTable(t("erp.name"), t("docs.status"), t("docs.when"));
        private final JLabel empty = Ui.label(t("docs.none"), "dim");

        DocumentsPanel() {
            super(new BorderLayout());
            table.onOpen(this::open);
            JPanel bar = Ui.row(Ui.button("+ " + t("docs.new"), this::create, null), Ui.button(t("common.refresh"), this::reload, "ghost"));
            add(Ui.page(t("docs.title"), bar, Ui.scroll(table), empty));
        }

        @Override public void reload() {
            Ui.async(Api.I::instances, items -> {
                List<String[]> rows = new ArrayList<>();
                for (Map<String, Object> i : items) {
                    String at = Json.str(i.get("startedAt"));
                    rows.add(new String[]{Json.str(i.get("definitionName")), Json.str(i.get("status")), (at.length() >= 16 ? at.substring(0, 16) : at).replace('T', ' ')});
                }
                table.fill(rows, items);
                empty.setVisible(rows.isEmpty());
            }, m -> Ui.warn(this, m));
        }

        private void create() {
            Ui.async(Api.I::definitions, defs -> { if (new NewRequestDialog(this, defs).showAndResult()) reload(); }, m -> Ui.warn(this, m));
        }

        @SuppressWarnings("unchecked")
        private void open() {
            Map<String, Object> sel = (Map<String, Object>) table.selected();
            if (sel == null) return;
            Ui.async(() -> Api.I.instance(Json.str(sel.get("id"))), full -> { if (new InstanceDialog(this, full.isEmpty() ? sel : full).showAndResult()) reload(); }, m -> Ui.warn(this, m));
        }
    }

    static final class InstanceDialog extends JDialog {
        private boolean changed;

        InstanceDialog(java.awt.Component parent, Map<String, Object> inst) {
            super((Window) javax.swing.SwingUtilities.getWindowAncestor(parent), Json.str(inst.get("definitionName")), Dialog.ModalityType.APPLICATION_MODAL);
            JPanel body = new JPanel(new BorderLayout(0, 8));
            body.setBorder(BorderFactory.createEmptyBorder(14, 16, 14, 16));
            JPanel top = new JPanel(new GridLayout(0, 1));
            top.add(Ui.label(Json.str(inst.get("definitionName")), "title"));
            top.add(Ui.label(t("docs.status") + ": " + Json.str(inst.get("status")), null));
            top.add(Ui.label(t("docs.history"), "title"));
            body.add(top, BorderLayout.NORTH);
            Ui.DataTable tb = new Ui.DataTable(t("erp.name"), t("docs.status"), t("appr.requestedBy"), t("appr.comment"));
            List<String[]> rows = new ArrayList<>();
            for (Object h : Json.arr(inst.get("history"))) {
                Map<String, Object> m = Json.obj(h);
                rows.add(new String[]{Json.str(m.get("nodeName")), Json.str(m.get("action")), Json.str(m.get("actor")), Json.str(m.get("comment"))});
            }
            tb.fill(rows, rows);
            body.add(Ui.scroll(tb), BorderLayout.CENTER);
            JPanel row = new JPanel(new FlowLayout(FlowLayout.LEADING));
            if ("Running".equals(inst.get("status")))
                row.add(Ui.button(t("docs.cancel"), () -> {
                    if (!Ui.ask(this, t("docs.cancel") + "?", t("common.yes"), t("common.no"))) return;
                    Ui.async(() -> { Api.I.cancelInstance(Json.str(inst.get("id"))); return Boolean.TRUE; }, r -> { changed = true; dispose(); }, m -> Ui.warn(this, m));
                }, "danger"));
            row.add(Ui.button(t("common.close"), this::dispose, "ghost"));
            body.add(row, BorderLayout.SOUTH);
            setContentPane(body);
            setSize(560, 440);
            setLocationRelativeTo(parent);
            setModalityType(Dialog.ModalityType.APPLICATION_MODAL);
        }

        boolean showAndResult() { setVisible(true); return changed; }
    }

    static final class NewRequestDialog extends JDialog {
        private boolean done;

        NewRequestDialog(java.awt.Component parent, List<Map<String, Object>> defs) {
            super((Window) javax.swing.SwingUtilities.getWindowAncestor(parent), t("docs.choose"), Dialog.ModalityType.APPLICATION_MODAL);
            JPanel body = new JPanel();
            body.setLayout(new BoxLayout(body, BoxLayout.Y_AXIS));
            body.setBorder(BorderFactory.createEmptyBorder(14, 16, 14, 16));
            body.add(Ui.label(t("docs.choose"), "title"));
            JComboBox<String> combo = new JComboBox<>();
            for (Map<String, Object> d : defs) combo.addItem(Json.str(d.get("name")));
            body.add(combo);
            body.add(Box.createVerticalStrut(8));
            body.add(Ui.label(t("appr.comment"), "dim"));
            JTextArea note = new JTextArea(3, 30);
            body.add(Ui.scroll(note));
            JLabel err = Ui.label("", "error");
            body.add(err);
            JPanel row = new JPanel(new FlowLayout(FlowLayout.LEADING));
            JButton go = Ui.button(t("docs.start"), () -> { }, null);
            go.setEnabled(!defs.isEmpty());
            for (java.awt.event.ActionListener l : go.getActionListeners()) go.removeActionListener(l);
            go.addActionListener(e -> {
                int i = combo.getSelectedIndex();
                if (i < 0) return;
                Map<String, Object> data = new LinkedHashMap<>();
                if (!note.getText().isBlank()) data.put("note", note.getText().trim());
                go.setEnabled(false);
                Ui.async(() -> {
                    Map<String, Object> inst = Api.I.startInstance(Json.str(defs.get(i).get("id")), data);
                    // a flow that begins with a form step asks for it right away, like the portal's Submit screen
                    for (Map<String, Object> tk : Api.I.tasks())
                        if (Json.str(tk.get("instanceId")).equals(Json.str(inst.get("id"))) && !Json.arr(Json.obj(tk.get("form")).get("fields")).isEmpty()) return tk;
                    return null;
                }, tk -> { done = true; dispose(); if (tk != null) new ApprovalDialog(parent, tk, null).showAndResult(); },
                        m -> { err.setText("<html>" + m + "</html>"); go.setEnabled(true); });
            });
            row.add(go);
            row.add(Ui.button(t("common.cancel"), this::dispose, "ghost"));
            body.add(row);
            setContentPane(body);
            pack();
            setMinimumSize(new java.awt.Dimension(420, 0));
            setLocationRelativeTo(parent);
        }

        boolean showAndResult() { setVisible(true); return done; }
    }
}
