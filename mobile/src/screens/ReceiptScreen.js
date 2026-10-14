import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { formatDate, money, useTheme } from '../theme';

export default function ReceiptScreen({ bill, from, go }) {
  const { colors, ui } = useTheme();
  const done = () => go(from === 'history' ? 'history' : 'shops');

  return (
    <ScrollView contentContainerStyle={ui.pad}>
      {from === 'payment' && (
        <View style={{ alignItems: 'center', marginBottom: 16 }}>
          <View
            style={{
              width: 64, height: 64, borderRadius: 32, backgroundColor: colors.okSoft,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 32, color: colors.ok }}>{'✓'}</Text>
          </View>
          <Text style={[ui.h1, { marginTop: 8 }]}>Payment successful</Text>
          <Text style={ui.muted}>Thank you for shopping at {bill.shopName}</Text>
        </View>
      )}

      <View style={[ui.card, { alignItems: 'center', marginBottom: 14, backgroundColor: colors.brandSoft, borderColor: colors.brand }]}>
        <Text style={ui.muted}>Your bill ID</Text>
        <Text selectable style={{ fontSize: 22, fontWeight: '800', color: colors.brandDark, letterSpacing: 0.5, marginVertical: 4 }}>
          {bill.code}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>
          Show this ID to the staff if they ask. They already have a copy of this bill.
        </Text>
      </View>

      <View style={ui.card}>
        <Text style={ui.h2}>{bill.shopName}</Text>
        <Text style={[ui.muted, { marginBottom: 12 }]}>{formatDate(bill.paidAt)}</Text>

        {bill.items.map((i) => (
          <View key={i.barcode} style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.ink }}>{i.name}</Text>
              <Text style={ui.muted}>
                {i.quantity} {'×'} {money(i.priceCents)}
              </Text>
            </View>
            <Text style={{ fontWeight: '600', color: colors.ink }}>{money(i.lineTotalCents)}</Text>
          </View>
        ))}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>Total paid</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.ink }}>{money(bill.totalCents)}</Text>
        </View>
        <Text style={{ marginTop: 10, color: colors.muted }}>
          Paid by {bill.paymentMethod === 'upi' ? 'UPI' : 'card'}
        </Text>
        <Text style={{ marginTop: 4, color: bill.reviewed ? colors.ok : colors.muted }}>
          {bill.reviewed ? 'Reviewed by shop staff ✓' : 'Waiting for staff review'}
        </Text>
      </View>

      <TouchableOpacity style={[ui.button, { marginTop: 18 }]} onPress={done}>
        <Text style={ui.buttonText}>{from === 'history' ? 'Back to my bills' : 'Done'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
