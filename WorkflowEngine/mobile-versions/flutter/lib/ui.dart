import 'package:flutter/material.dart';

const kPrimary = Color(0xFF2563EB);
const kDim = Color(0xFF64748B);
const kBg = Color(0xFFF4F6FA);
const kDanger = Color(0xFFDC2626);
const kOk = Color(0xFF16A34A);

Color statusColor(String? st) {
  switch (st) {
    case 'Approved':
    case 'Active':
    case 'Completed':
    case 'Posted':
    case 'Paid':
      return kOk;
    case 'Rejected':
    case 'Cancelled':
    case 'Terminated':
    case 'Expired':
      return kDanger;
    case 'Pending':
    case 'Draft':
    case 'Running':
      return const Color(0xFFD97706);
    default:
      return kPrimary;
  }
}

class Chip2 extends StatelessWidget {
  const Chip2(this.text, {super.key, this.color = kPrimary});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withOpacity(0.13), borderRadius: BorderRadius.circular(99)),
        child: Text(text, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      );
}

class EmptyText extends StatelessWidget {
  const EmptyText(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.all(40), child: Center(child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: kDim))));
}

class Pad extends StatelessWidget {
  const Pad({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5), child: child);
}

void snack(BuildContext c, String msg) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(msg)));
