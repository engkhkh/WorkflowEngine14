package erp;

import static erp.I18n.t;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.BiConsumer;
import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;

/** The ERP assistant: questions go to POST api/assistant/chat, which answers from the live data this user may see. */
public final class Chat {
    private Chat() { }

    public static class ChatPanel extends JPanel implements Reloadable {
        private final BiConsumer<String, String> open;
        private final JPanel log = new JPanel();
        private final JScrollPane scroll;
        private final JPanel sugs = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 2));
        private final JTextField input = new JTextField();
        private final JButton sendBtn;
        private final List<Map<String, Object>> history = new ArrayList<>();
        private boolean busy;

        public ChatPanel(BiConsumer<String, String> open) {
            super(new BorderLayout(0, 8));
            this.open = open;
            setBorder(BorderFactory.createEmptyBorder(16, 20, 16, 20));
            add(Ui.label(t("chat.title"), "title"), BorderLayout.NORTH);
            log.setLayout(new BoxLayout(log, BoxLayout.Y_AXIS));
            JPanel holder = new JPanel(new BorderLayout());
            holder.add(log, BorderLayout.NORTH);
            scroll = new JScrollPane(holder);
            scroll.getVerticalScrollBar().setUnitIncrement(16);
            add(scroll, BorderLayout.CENTER);

            JPanel bottom = new JPanel(new BorderLayout(0, 6));
            bottom.add(sugs, BorderLayout.NORTH);
            JPanel row = new JPanel(new BorderLayout(8, 0));
            sendBtn = Ui.button(t("chat.send"), () -> send(input.getText()), null);
            input.addActionListener(e -> send(input.getText()));
            row.add(input, BorderLayout.CENTER);
            row.add(sendBtn, BorderLayout.LINE_END);
            bottom.add(row, BorderLayout.SOUTH);
            add(bottom, BorderLayout.SOUTH);
            bubble(false, t("chat.greet"), new ArrayList<>());
        }

        @Override public void reload() { input.requestFocusInWindow(); }

        private JPanel bubble(boolean mine, String text, List<Object> actions) {
            JPanel box = new JPanel(new BorderLayout(0, 6));
            box.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createLineBorder(mine ? Ui.PRIMARY : new java.awt.Color(0xE2, 0xE8, 0xF0)), BorderFactory.createEmptyBorder(8, 10, 8, 10)));
            box.setBackground(mine ? new java.awt.Color(0xDB, 0xEA, 0xFE) : java.awt.Color.WHITE);
            javax.swing.JTextArea msg = new javax.swing.JTextArea(text);
            msg.setLineWrap(true);
            msg.setWrapStyleWord(true);
            msg.setEditable(false);
            msg.setOpaque(false);
            msg.setColumns(48);
            box.add(msg, BorderLayout.CENTER);
            if (!actions.isEmpty()) {
                JPanel acts = new JPanel(new FlowLayout(FlowLayout.LEADING, 6, 0));
                acts.setOpaque(false);
                for (Object o : actions) {
                    Map<String, Object> a = Json.obj(o);
                    String mod = Json.str(a.get("module")), kind = Json.str(a.get("kind"));
                    acts.add(Ui.button(Json.str(a.get("label")) + " ›", () -> open.accept(mod, kind), "ghost"));
                }
                box.add(acts, BorderLayout.SOUTH);
            }
            JPanel wrap = new JPanel(new FlowLayout(mine ? FlowLayout.TRAILING : FlowLayout.LEADING, 0, 4));
            wrap.setOpaque(false);
            wrap.add(box);
            log.add(wrap);
            log.revalidate();
            SwingUtilities.invokeLater(() -> scroll.getVerticalScrollBar().setValue(scroll.getVerticalScrollBar().getMaximum()));
            return wrap;
        }

        /** Used by the tests too. */
        public void send(String text) {
            String q = text == null ? "" : text.trim();
            if (q.isEmpty() || busy) return;
            busy = true;
            sendBtn.setEnabled(false);
            input.setText("");
            List<Map<String, Object>> past = new ArrayList<>(history.subList(Math.max(0, history.size() - 6), history.size()));
            history.add(Map.of("from", "user", "text", q));
            bubble(true, q, new ArrayList<>());
            JPanel thinking = bubble(false, t("chat.thinking"), new ArrayList<>());
            Runnable done = () -> { log.remove(thinking); log.revalidate(); log.repaint(); busy = false; sendBtn.setEnabled(true); };
            Ui.async(() -> Api.I.chat(q, I18n.lang, past), r -> {
                done.run();
                String reply = Json.str(r.get("reply"));
                history.add(Map.of("from", "ai", "text", reply));
                bubble(false, reply, Json.arr(r.get("actions")));
                sugs.removeAll();
                for (Object s : Json.arr(r.get("suggestions"))) {
                    String st = Json.str(s);
                    sugs.add(Ui.button(st, () -> send(st), "ghost"));
                }
                sugs.revalidate();
                sugs.repaint();
            }, err -> { done.run(); bubble(false, t("chat.error"), new ArrayList<>()); });
        }
    }
}
