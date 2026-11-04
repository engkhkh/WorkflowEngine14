import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { useApp } from './ctx';

export const colors = { primary: '#2563eb', bg: '#f4f6fa', card: '#ffffff', border: '#e2e8f0', text: '#0f172a', dim: '#64748b', danger: '#dc2626', ok: '#16a34a' };

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { rtl } = useApp();
  return <View style={[s.screen, { direction: rtl ? 'rtl' : 'ltr' }, style]}>{children}</View>;
}
export function Card({ children, onPress, style }: { children: React.ReactNode; onPress?: () => void; style?: ViewStyle }) {
  return <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.card, pressed && onPress ? { opacity: 0.7 } : null, style]}>{children}</Pressable>;
}
export function Btn({ title, onPress, kind = 'primary', disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'danger' | 'ghost'; disabled?: boolean }) {
  const bg = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : 'transparent';
  const fg = kind === 'ghost' ? colors.primary : '#fff';
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderWidth: kind === 'ghost' ? 1 : 0, borderColor: colors.primary }]}>
      <Text style={{ color: fg, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}
export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  const { rtl } = useApp();
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.dim} {...rest} style={[s.input, { textAlign: rtl ? 'right' : 'left' }, style]} />
    </View>
  );
}
export function Chip({ text, color = colors.primary }: { text: string; color?: string }) {
  return <View style={[s.chip, { backgroundColor: color + '22' }]}><Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text></View>;
}
export function Empty({ text }: { text: string }) { return <Text style={s.empty}>{text}</Text>; }
export function Busy() { return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />; }
export function ErrorText({ text }: { text?: string }) { return text ? <Text style={{ color: colors.danger, marginVertical: 8 }}>{text}</Text> : null; }

export function statusColor(st?: string | null) {
  switch (st) {
    case 'Approved': case 'Active': case 'Completed': case 'Posted': case 'Paid': return colors.ok;
    case 'Rejected': case 'Cancelled': case 'Terminated': case 'Expired': return colors.danger;
    case 'Pending': case 'Draft': case 'Running': return '#d97706';
    default: return colors.primary;
  }
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, marginHorizontal: 14, marginTop: 10 },
  btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', marginVertical: 4 },
  label: { color: colors.dim, fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.text, fontSize: 15 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  empty: { textAlign: 'center', color: colors.dim, marginTop: 40, paddingHorizontal: 24 },
});
