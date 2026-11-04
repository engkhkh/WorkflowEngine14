package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.CardLayout;
import java.awt.ComponentOrientation;
import java.awt.Dimension;
import java.awt.GridLayout;
import javax.swing.BorderFactory;
import javax.swing.DefaultListModel;
import javax.swing.JDialog;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;

public final class Main {
    private static JFrame frame;

    private Main() { }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            try { UIManager.setLookAndFeel("javax.swing.plaf.nimbus.NimbusLookAndFeel"); } catch (Exception ignored) { /* default look */ }
            I18n.init();
            Api.I.load();
            if (Api.I.signedIn()) Api.I.refreshMe();
            show();
        });
    }

    /** Shows the login window when signed out, otherwise the main window. */
    static void show() {
        if (frame != null) { frame.dispose(); frame = null; }
        if (!Api.I.signedIn() && !login()) { System.exit(0); return; }
        frame = build();
        frame.applyComponentOrientation(I18n.rtl() ? ComponentOrientation.RIGHT_TO_LEFT : ComponentOrientation.LEFT_TO_RIGHT);
        frame.setVisible(true);
    }

    private static boolean login() {
        JDialog d = new JDialog((JFrame) null, t("app.title"), true);
        JTextField server = new JTextField(Api.DEFAULT_SERVER, 24), user = new JTextField(24);
        JPasswordField pw = new JPasswordField(24);
        JLabel err = Ui.label("", "error");
        boolean[] ok = {false};
        javax.swing.JButton go = Ui.button(t("login.signin"), () -> { }, null);
        Runnable doLogin = () -> {
            err.setText("");
            go.setEnabled(false);
            Ui.async(() -> { Api.I.login(server.getText(), user.getText().trim(), new String(pw.getPassword())); return Boolean.TRUE; },
                    r -> { ok[0] = true; d.dispose(); }, m -> { err.setText(t("login.failed")); go.setEnabled(true); });
        };
        for (java.awt.event.ActionListener l : go.getActionListeners()) go.removeActionListener(l);
        go.addActionListener(e -> doLogin.run());
        pw.addActionListener(e -> doLogin.run());
        JPanel form = new JPanel(new GridLayout(0, 1, 0, 4));
        form.setBorder(BorderFactory.createEmptyBorder(20, 24, 20, 24));
        form.add(Ui.label(t("app.name"), "title"));
        form.add(Ui.label(t("login.title"), "dim"));
        form.add(new JLabel(t("login.server"))); form.add(server);
        form.add(new JLabel(t("login.user"))); form.add(user);
        form.add(new JLabel(t("login.pass"))); form.add(pw);
        form.add(err); form.add(go);
        d.setContentPane(form);
        d.getComponent(0);
        d.applyComponentOrientation(I18n.rtl() ? ComponentOrientation.RIGHT_TO_LEFT : ComponentOrientation.LEFT_TO_RIGHT);
        d.pack();
        d.setLocationRelativeTo(null);
        d.setDefaultCloseOperation(JDialog.DISPOSE_ON_CLOSE);
        d.setVisible(true);
        return ok[0];
    }

    static JFrame build() {
        JFrame f = new JFrame(t("app.title") + " — " + Api.I.displayName);
        f.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        f.setSize(1180, 740);
        f.setLocationRelativeTo(null);

        CardLayout cards = new CardLayout();
        JPanel stack = new JPanel(cards);
        Pages2.ErpPanel erp = new Pages2.ErpPanel();
        Reloadable[] pages = new Reloadable[19];
        DefaultListModel<String> navModel = new DefaultListModel<>();
        for (String k : new String[]{"tab.home", "tab.approvals", "tab.documents", "tab.reports", "tab.erp", "tab.chat", "tab.workflow", "tab.muslim", "tab.pos", "tab.hos", "tab.cal", "tab.fin", "tab.hr", "tab.ops", "tab.web", "tab.cus", "tab.adm", "tab.act", "tab.more"}) navModel.addElement(t(k));
        JList<String> nav = new JList<>(navModel);
        nav.setFixedCellHeight(44);
        nav.setSelectionMode(javax.swing.ListSelectionModel.SINGLE_SELECTION);
        nav.setBackground(new java.awt.Color(0x0F, 0x17, 0x2A));
        nav.setForeground(new java.awt.Color(0xCB, 0xD5, 0xE1));
        nav.setSelectionBackground(Ui.PRIMARY);
        nav.setSelectionForeground(java.awt.Color.WHITE);
        nav.setBorder(BorderFactory.createEmptyBorder(6, 8, 6, 8));

        java.util.function.IntConsumer go = i -> { if (nav.getSelectedIndex() != i) nav.setSelectedIndex(i); };
        pages[0] = new Dashboard.DashboardPanel(go, (m, k) -> { go.accept(4); erp.select(m, k); });
        pages[1] = new Pages1.ApprovalsPanel();
        pages[2] = new Pages1.DocumentsPanel();
        pages[3] = new Dashboard.ReportsPanel();
        pages[4] = erp;
        pages[5] = new Chat.ChatPanel((mod, kind) -> {
            if ("gov".equals(mod) && "approval".equals(kind)) go.accept(1);
            else { go.accept(4); erp.select(mod, kind); }
        });
        pages[6] = new Workflow.WorkflowPanel();
        pages[7] = new Muslim.MuslimPanel();
        pages[8] = new Pos.PosPanel();
        pages[9] = new Hospital.HospitalPanel();
        pages[10] = new CalPanels.CalendarPanel();
        pages[11] = new Finance.FinancePanel();
        pages[12] = new Hr.HrPanel();
        pages[13] = new Ops.OpsPanel();
        pages[14] = new Site.SitePanel();
        pages[15] = new Custom.CustomPanel();
        pages[16] = new Admin.AdminPanel();
        pages[17] = new Actions.ActionsPanel();
        pages[18] = new Pages2.SettingsPanel(l -> { if (!l.equals(I18n.lang)) { I18n.setLang(l); show(); } }, () -> { Api.I.signOut(); show(); });
        for (int i = 0; i < pages.length; i++) stack.add((JPanel) pages[i], String.valueOf(i));
        nav.addListSelectionListener(e -> {
            if (e.getValueIsAdjusting()) return;
            int i = nav.getSelectedIndex();
            if (i < 0) return;
            cards.show(stack, String.valueOf(i));
            pages[i].reload();
        });

        JPanel root = new JPanel(new BorderLayout());
        JPanel side = new JPanel(new BorderLayout());
        side.setPreferredSize(new Dimension(190, 0));
        side.add(nav);
        root.add(side, BorderLayout.LINE_START);
        root.add(stack, BorderLayout.CENTER);
        f.setContentPane(root);
        nav.setSelectedIndex(0);
        return f;
    }
}
