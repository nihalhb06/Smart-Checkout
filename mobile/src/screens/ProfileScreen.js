import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { formatDay, money, useTheme } from '../theme';

const MODES = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

export default function ProfileScreen({ user, go, onLogout }) {
  const { colors, ui, mode, setMode } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('active');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.get('/profile'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const initials = (data?.user.name || user.name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  const coupons = data?.coupons ?? [];
  const shown = coupons.filter((c) => (tab === 'active' ? !c.used && !c.expired : c.used || c.expired));

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={[ui.rowBetween, { marginBottom: 16 }]}>
        <TouchableOpacity onPress={() => go('shops')} hitSlop={12}>
          <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>{'‹'} Shops</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogout} hitSlop={10}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>Log out</Text>
        </TouchableOpacity>
      </View>

      {/* Identity */}
      <View style={[ui.card, { alignItems: 'center', paddingVertical: 22 }]}>
        <View
          style={{
            width: 76,
            height: 76,
            borderRadius: 38,
            backgroundColor: colors.brand,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>{initials}</Text>
        </View>
        <Text style={ui.h1}>{data?.user.name || user.name}</Text>
        <Text style={ui.muted}>{data?.user.email || user.email}</Text>
        {!!data?.user.memberSince && (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            Member since {formatDay(data.user.memberSince)}
          </Text>
        )}
      </View>

      {!!error && <Text style={[ui.error, { marginTop: 12 }]}>{error}</Text>}

      {!data ? (
        <ActivityIndicator style={{ marginTop: 30 }} size="large" color={colors.brand} />
      ) : (
        <>
          {/* Stats */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Stat label="Bills" value={String(data.stats.billCount)} />
            <Stat label="Spent" value={money(data.stats.totalSpentCents)} />
            <Stat label="Items" value={String(data.stats.itemsScanned)} />
          </View>
          {!!data.stats.favouriteShop && (
            <Text style={[ui.muted, { marginTop: 10, textAlign: 'center' }]}>
              Most visited: {data.stats.favouriteShop}
            </Text>
          )}

          {/* Shortcuts */}
          <View style={{ marginTop: 22 }}>
            <Text style={ui.sectionLabel}>Activity</Text>
            <Row
              icon="🧾"
              title="My past bills"
              subtitle={`${data.stats.billCount} bill${data.stats.billCount === 1 ? '' : 's'} · tap to view`}
              onPress={() => go('history')}
            />
          </View>

          {/* Coupons */}
          <View style={{ marginTop: 22 }}>
            <Text style={ui.sectionLabel}>My coupons</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {['active', 'past'].map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTab(t)}
                  style={[
                    ui.pill,
                    tab === t && { backgroundColor: colors.brand, borderColor: colors.brand },
                  ]}
                >
                  <Text
                    style={{
                      fontWeight: '600',
                      fontSize: 13,
                      color: tab === t ? '#fff' : colors.muted,
                    }}
                  >
                    {t === 'active' ? `Available (${data.stats.couponsAvailable})` : 'Used & expired'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {shown.length === 0 ? (
              <View style={[ui.card, { alignItems: 'center', paddingVertical: 24 }]}>
                <Text style={{ fontSize: 26, marginBottom: 6 }}>{'🎟️'}</Text>
                <Text style={ui.muted}>
                  {tab === 'active' ? 'No coupons available right now.' : 'Nothing used or expired yet.'}
                </Text>
              </View>
            ) : (
              shown.map((c) => <Coupon key={c.code} coupon={c} />)
            )}
          </View>

          {/* Appearance */}
          <View style={{ marginTop: 22 }}>
            <Text style={ui.sectionLabel}>Appearance</Text>
            <View style={[ui.card, { padding: 12 }]}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {MODES.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    onPress={() => setMode(m.key)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 10,
                      alignItems: 'center',
                      borderWidth: 1,
                      borderColor: mode === m.key ? colors.brand : colors.line,
                      backgroundColor: mode === m.key ? colors.brandSoft : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 18 }}>{m.key === 'system' ? '📱' : m.key === 'light' ? '☀️' : '🌙'}</Text>
                    <Text
                      style={{
                        marginTop: 4,
                        fontWeight: '600',
                        fontSize: 13,
                        color: mode === m.key ? colors.brandDark : colors.muted,
                      }}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>
                {mode === 'system' ? 'Following your phone’s light/dark setting.' : `Always ${mode}.`}
              </Text>
            </View>
          </View>

          {/* Help */}
          <View style={{ marginTop: 22 }}>
            <Text style={ui.sectionLabel}>Help</Text>
            <Row
              icon="💬"
              title="Ask the assistant"
              subtitle="Find an item, check a price, or learn how the app works"
              onPress={() => go('shops', { openAssistant: true })}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Stat({ label, value }) {
  const { colors, ui } = useTheme();
  return (
    <View style={[ui.card, { flex: 1, alignItems: 'center', padding: 14 }]}>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

function Row({ icon, title, subtitle, onPress }) {
  const { colors, ui } = useTheme();
  return (
    <TouchableOpacity style={[ui.card, { flexDirection: 'row', alignItems: 'center', padding: 14 }]} onPress={onPress}>
      <Text style={{ fontSize: 22, marginRight: 12 }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={ui.h3}>{title}</Text>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{subtitle}</Text>
      </View>
      <Text style={{ color: colors.brand, fontSize: 22 }}>{'›'}</Text>
    </TouchableOpacity>
  );
}

function Coupon({ coupon }) {
  const { colors, ui } = useTheme();
  const dead = coupon.used || coupon.expired;
  const value = coupon.kind === 'percent' ? `${coupon.value}% OFF` : `${money(coupon.value)} OFF`;

  return (
    <View
      style={[
        ui.card,
        {
          marginBottom: 10,
          padding: 0,
          overflow: 'hidden',
          flexDirection: 'row',
          opacity: dead ? 0.55 : 1,
          borderColor: dead ? colors.line : colors.brand,
        },
      ]}
    >
      <View
        style={{
          width: 92,
          backgroundColor: dead ? colors.line : colors.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
        }}
      >
        <Text style={{ fontWeight: '800', color: dead ? colors.muted : colors.brandDark, textAlign: 'center' }}>
          {value}
        </Text>
      </View>
      <View style={{ flex: 1, padding: 12 }}>
        <Text style={ui.h3}>{coupon.title}</Text>
        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>{coupon.description}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
          <View style={{ backgroundColor: colors.cardAlt, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            <Text selectable style={{ fontWeight: '800', color: colors.brandDark, letterSpacing: 0.5, fontSize: 13 }}>
              {coupon.code}
            </Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            {coupon.shopName ? coupon.shopName : 'Any shop'}
            {coupon.expiresAt ? ` · till ${coupon.expiresAt}` : ''}
          </Text>
        </View>
        {coupon.used && (
          <Text style={{ color: colors.ok, fontSize: 12, marginTop: 6 }}>
            Used{coupon.billCode ? ` on bill ${coupon.billCode}` : ''}
          </Text>
        )}
        {!coupon.used && coupon.expired && (
          <Text style={{ color: colors.danger, fontSize: 12, marginTop: 6 }}>Expired</Text>
        )}
      </View>
    </View>
  );
}
