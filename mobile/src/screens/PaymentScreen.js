import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '../api';
import { money, useTheme } from '../theme';

// Step 1: choose how to pay. Step 2a: UPI app + enter the transaction ID. Step 2b: card gateway page.
export default function PaymentScreen({ payment, shop, go }) {
  const { colors, ui } = useTheme();
  const [method, setMethod] = useState(null); // null | 'upi' | 'card'
  const finished = useRef(false);

  const backToCart = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    try {
      await api.post(`/payments/${payment.id}/cancel`);
    } catch {}
    go('scan', { shop });
  }, [payment.id, shop, go]);

  const openReceipt = useCallback(
    async (billCode) => {
      finished.current = true;
      const { bill } = await api.get(`/bills/${billCode}`);
      go('receipt', { bill, from: 'payment' });
    },
    [go]
  );

  const back = () => {
    if (method) {
      setMethod(null);
      return;
    }
    Alert.alert('Cancel payment?', 'You can go back and keep editing your bill.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Back to bill', onPress: backToCart },
    ]);
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => sub.remove();
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
        <TouchableOpacity onPress={back} hitSlop={12}>
          <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>
            {'‹'} {method ? 'Payment options' : 'Back to bill'}
          </Text>
        </TouchableOpacity>
        <Text style={[ui.h2, { flex: 1, textAlign: 'right' }]}>{money(payment.amountCents)}</Text>
      </View>

      {method === null && <MethodChooser payment={payment} shop={shop} onPick={setMethod} />}
      {method === 'upi' && <UpiStep payment={payment} onPaid={openReceipt} />}
      {method === 'card' && <CardStep payment={payment} finished={finished} onPaid={openReceipt} />}
    </View>
  );
}

function MethodChooser({ payment, shop, onPick }) {
  const { colors, ui } = useTheme();
  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <Text style={ui.h1}>Pay {money(payment.amountCents)}</Text>
      <Text style={[ui.muted, { marginBottom: 18 }]}>to {shop.name}. Choose how you want to pay.</Text>

      <TouchableOpacity style={[ui.card, { marginBottom: 12, flexDirection: 'row', alignItems: 'center' }]} onPress={() => onPick('upi')}>
        <Text style={{ fontSize: 30, marginRight: 14 }}>{'📱'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={ui.h2}>UPI app</Text>
          <Text style={ui.muted}>Google Pay, PhonePe, Paytm and more</Text>
        </View>
        <Text style={{ color: colors.brand, fontSize: 22 }}>{'›'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[ui.card, { flexDirection: 'row', alignItems: 'center' }]} onPress={() => onPick('card')}>
        <Text style={{ fontSize: 30, marginRight: 14 }}>{'💳'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={ui.h2}>Card</Text>
          <Text style={ui.muted}>Secure payment page (test mode)</Text>
        </View>
        <Text style={{ color: colors.brand, fontSize: 22 }}>{'›'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function UpiStep({ payment, onPaid }) {
  const { colors, ui } = useTheme();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upi = payment.upi;

  const openUpiApp = async () => {
    setError('');
    try {
      await Linking.openURL(upi.link);
      setOpened(true);
    } catch {
      setError('No UPI app was found on this phone. Install Google Pay / PhonePe / Paytm, or pay by card.');
    }
  };

  const confirm = async () => {
    setError('');
    setBusy(true);
    try {
      const { payment: p } = await api.post(`/payments/${payment.id}/confirm-upi`);
      await onPaid(p.billCode);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={ui.pad}>
      <Text style={ui.h2}>Pay with your UPI app</Text>
      <Text style={[ui.muted, { marginTop: 4, marginBottom: 12 }]}>
        {money(payment.amountCents)} to {upi.payeeName} ({upi.vpa}). Bill ID {payment.billCode}.
      </Text>
      {upi.isDemoVpa && (
        <Text style={{ color: colors.danger, marginBottom: 12 }}>
          Demo mode: this shop has no real UPI ID set yet, so a real payment would fail. Set UPI_ID on the server.
        </Text>
      )}
      <TouchableOpacity style={ui.button} onPress={openUpiApp}>
        <Text style={ui.buttonText}>{opened ? 'Open UPI app again' : 'Open UPI app'}</Text>
      </TouchableOpacity>

      {opened && (
        <View style={{ marginTop: 28 }}>
          <Text style={[ui.muted, { marginBottom: 10 }]}>Finished paying? Come back here and tap the button below.</Text>
          {!!error && <Text style={ui.error}>{error}</Text>}
          <TouchableOpacity style={[ui.button, { backgroundColor: colors.ok }, busy && { opacity: 0.6 }]} onPress={confirm} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>I have paid</Text>}
          </TouchableOpacity>
        </View>
      )}
      {!opened && !!error && <Text style={[ui.error, { marginTop: 12 }]}>{error}</Text>}
    </ScrollView>
  );
}

function CardStep({ payment, finished, onPaid }) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);

  // Poll the payment status; the gateway page itself never talks to the app.
  useEffect(() => {
    let stopped = false;
    let timer;
    const tick = async () => {
      if (stopped || finished.current) return;
      try {
        const { payment: p } = await api.get(`/payments/${payment.id}`);
        if (p.status === 'succeeded' && p.billCode) {
          await onPaid(p.billCode);
          return;
        }
      } catch {}
      if (!stopped) timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [payment.id, finished, onPaid]);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        source={{ uri: payment.payUrl }}
        onLoadEnd={() => setLoading(false)}
        style={{ flex: 1, backgroundColor: colors.bg }}
      />
      {loading && (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      )}
    </View>
  );
}
