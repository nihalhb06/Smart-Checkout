import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../api';
import { money, useTheme } from '../theme';
import Assistant, { AssistantButton } from '../components/Assistant';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'];
const SAME_CODE_COOLDOWN_MS = 4000; // a barcode held in view is only handled once per cooldown

function withTotals(cart, items) {
  return {
    ...cart,
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    totalCents: items.reduce((n, i) => n + i.lineTotalCents, 0),
  };
}

export default function ScanScreen({ shop, go }) {
  const { colors, ui } = useTheme();
  const [cart, setCart] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null); // { text, ok }
  const [cameraOn, setCameraOn] = useState(true);
  const [manual, setManual] = useState('');
  const [paying, setPaying] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const cartRef = useRef(null);
  const seq = useRef(0);
  const lastScan = useRef({ code: '', at: 0 });
  const toastTimer = useRef(null);

  const apply = (c) => {
    cartRef.current = c;
    setCart(c);
  };

  const showToast = useCallback((text, ok = true) => {
    setToast({ text, ok });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Open (or resume) the bill for this shop.
  useEffect(() => {
    api
      .post('/carts', { shopId: shop.id })
      .then((r) => apply(r.cart))
      .catch((e) => setError(e.message));
  }, [shop.id]);

  const refetch = useCallback(async () => {
    try {
      const r = await api.get(`/carts/${cartRef.current.id}`);
      apply(r.cart);
    } catch {}
  }, []);

  // Only the newest response updates the screen, so quick taps never flicker back to old totals.
  const sync = async (promise) => {
    const mine = ++seq.current;
    try {
      const r = await promise;
      if (mine === seq.current) apply(r.cart);
      return r;
    } catch (e) {
      showToast(e.message, false);
      if (mine === seq.current) refetch();
      return null;
    }
  };

  const scan = useCallback(
    async (rawCode) => {
      const code = String(rawCode || '').trim();
      if (!code || !cartRef.current || paying) return;
      const r = await sync(api.post(`/carts/${cartRef.current.id}/scan`, { barcode: code }));
      if (r?.scanned) {
        if (r.alreadyInCart) {
          showToast(`${r.scanned.name} is already in your bill. Use + to add more.`, false);
        } else {
          Vibration.vibrate(60);
          showToast(`Added ${r.scanned.name} • ${money(r.scanned.priceCents)}`);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paying, showToast]
  );

  const onBarcode = ({ data }) => {
    const now = Date.now();
    if (data === lastScan.current.code && now - lastScan.current.at < SAME_CODE_COOLDOWN_MS) return;
    lastScan.current = { code: data, at: now };
    scan(data);
  };

  const changeQty = (item, qty) => {
    const current = cartRef.current;
    const items =
      qty <= 0
        ? current.items.filter((i) => i.productId !== item.productId)
        : current.items.map((i) =>
            i.productId === item.productId ? { ...i, quantity: qty, lineTotalCents: i.priceCents * qty } : i
          );
    apply(withTotals(current, items)); // instant, optimistic update
    sync(api.patch(`/carts/${current.id}/items/${item.productId}`, { quantity: qty }));
  };

  const remove = (item) => {
    const current = cartRef.current;
    apply(withTotals(current, current.items.filter((i) => i.productId !== item.productId)));
    sync(api.del(`/carts/${current.id}/items/${item.productId}`));
  };

  const confirmRemove = (item) =>
    Alert.alert('Remove item', `Remove ${item.name} from your bill?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(item) },
    ]);

  const submitManual = () => {
    Keyboard.dismiss();
    scan(manual);
    setManual('');
  };

  const endShopping = async () => {
    if (!cart || cart.items.length === 0) {
      Alert.alert('Your bill is empty', 'Scan at least one product before ending your shopping.');
      return;
    }
    setPaying(true);
    try {
      seq.current++; // ignore any in-flight cart updates
      const { payment } = await api.post('/payments', { cartId: cart.id });
      go('payment', { payment, cart: cartRef.current, shop });
    } catch (e) {
      setPaying(false);
      Alert.alert('Could not start payment', e.message);
      refetch();
    }
  };

  if (error) {
    return (
      <View style={[ui.pad, { flex: 1, justifyContent: 'center' }]}>
        <Text style={ui.error}>{error}</Text>
        <TouchableOpacity style={ui.button} onPress={() => go('shops')}>
          <Text style={ui.buttonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cameraGranted = permission?.granted;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
        <TouchableOpacity onPress={() => go('shops')} hitSlop={12}>
          <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>{'‹'} Shops</Text>
        </TouchableOpacity>
        <Text style={[ui.h2, { flex: 1, textAlign: 'center' }]} numberOfLines={1}>
          {shop.name}
        </Text>
        <TouchableOpacity onPress={() => setCameraOn((v) => !v)} hitSlop={12}>
          <Text style={{ color: colors.brand, fontWeight: '600' }}>{cameraOn ? 'Pause' : 'Scan'}</Text>
        </TouchableOpacity>
      </View>

      {/* Scanner */}
      <View style={{ height: 210, marginHorizontal: 12, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.scanner }}>
        {!permission ? (
          <ActivityIndicator style={{ flex: 1 }} color="#fff" />
        ) : !cameraGranted ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 10 }}>Camera access is needed to scan barcodes.</Text>
            <TouchableOpacity style={[ui.button, { paddingHorizontal: 20 }]} onPress={requestPermission}>
              <Text style={ui.buttonText}>Allow camera</Text>
            </TouchableOpacity>
          </View>
        ) : cameraOn ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={onBarcode}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#aaa' }}>Scanner paused</Text>
          </View>
        )}
        {cameraGranted && cameraOn && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: '12%', right: '12%', top: '30%', bottom: '30%',
              borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 10,
            }}
          />
        )}
        {toast && (
          <View
            style={{
              position: 'absolute', left: 10, right: 10, bottom: 10, padding: 10, borderRadius: 10,
              backgroundColor: toast.ok ? colors.ok : colors.danger,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', textAlign: 'center' }}>{toast.text}</Text>
          </View>
        )}
      </View>

      {/* Manual entry (also handy on emulators without a camera) */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
        <TextInput
          style={[ui.input, { flex: 1, marginBottom: 0, paddingVertical: 9 }]}
          placeholder="Or type a barcode number"
          value={manual}
          onChangeText={setManual}
          keyboardType="number-pad"
          onSubmitEditing={submitManual}
          returnKeyType="done"
        />
        <TouchableOpacity style={[ui.button, { paddingHorizontal: 18, justifyContent: 'center' }]} onPress={submitManual}>
          <Text style={ui.buttonText}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Live e-bill */}
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={ui.h2}>Your e-bill</Text>
        <Text style={ui.muted}>{cart ? `${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}` : ''}</Text>
      </View>

      {!cart ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={colors.brand} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={cart.items}
          keyExtractor={(i) => String(i.productId)}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text style={[ui.muted, { textAlign: 'center', marginTop: 24 }]}>
              Point the camera at a product barcode to add it.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[ui.card, { marginBottom: 8, padding: 12, flexDirection: 'row', alignItems: 'center' }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontWeight: '600', color: colors.ink }} numberOfLines={2}>{item.name}</Text>
                <Text style={ui.muted}>{money(item.priceCents)} each</Text>
              </View>
              <QtyButton label={'−'} onPress={() => changeQty(item, item.quantity - 1)} />
              <Text style={{ width: 32, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink }}>{item.quantity}</Text>
              <QtyButton label="+" onPress={() => changeQty(item, item.quantity + 1)} />
              <Text style={{ width: 74, textAlign: 'right', fontWeight: '700', color: colors.ink }}>{money(item.lineTotalCents)}</Text>
              <TouchableOpacity onPress={() => confirmRemove(item)} hitSlop={10} style={{ paddingLeft: 10 }}>
                <Text style={{ fontSize: 18 }}>{'🗑️'}</Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      {/* Footer */}
      <View style={{ padding: 14, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink }}>Total</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{cart ? money(cart.totalCents) : '--'}</Text>
        </View>
        <TouchableOpacity
          style={[ui.button, (!cart || paying) && { opacity: 0.6 }]}
          onPress={endShopping}
          disabled={!cart || paying}
        >
          {paying ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>End shopping & pay</Text>}
        </TouchableOpacity>
      </View>

      <AssistantButton onPress={() => setChatOpen(true)} bottom={128} />
      <Assistant visible={chatOpen} onClose={() => setChatOpen(false)} shop={shop} />
    </View>
  );
}

function QtyButton({ label, onPress }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSoft,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.brand, lineHeight: 24 }}>{label}</Text>
    </TouchableOpacity>
  );
}
