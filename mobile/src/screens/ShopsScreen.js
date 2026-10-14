import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { money, useTheme } from '../theme';
import Assistant, { AssistantButton } from '../components/Assistant';

export default function ShopsScreen({ user, go, openAssistant }) {
  const { colors, ui } = useTheme();
  const [shops, setShops] = useState(null);
  const [resume, setResume] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [chatOpen, setChatOpen] = useState(!!openAssistant);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, c] = await Promise.all([api.get('/shops'), api.get('/carts/active')]);
      setShops(s.shops);
      setResume(c.cart && c.cart.items.length ? c.cart : null);
    } catch (e) {
      setError(e.message);
      setShops((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!shops) return [];
    if (!q) return shops;
    return shops.filter((s) =>
      [s.name, s.address, s.tagline].some((f) => String(f || '').toLowerCase().includes(q))
    );
  }, [shops, query]);

  const resumeShop = resume && shops?.find((s) => s.id === resume.shopId);
  const initials = (user.name || '?')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={ui.muted}>Hi, {user.name}</Text>
            <Text style={ui.h1}>Choose a shop</Text>
          </View>
          <TouchableOpacity
            onPress={() => go('profile')}
            hitSlop={10}
            accessibilityLabel="Open your profile"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.brand,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{initials}</Text>
          </TouchableOpacity>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 12,
            paddingHorizontal: 12,
            marginBottom: 8,
          }}
        >
          <Text style={{ fontSize: 16, marginRight: 8 }}>{'🔍'}</Text>
          <TextInput
            style={{ flex: 1, paddingVertical: 12, fontSize: 16, color: colors.ink }}
            placeholder="Search shops"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={10}>
              <Text style={{ color: colors.muted, fontSize: 18 }}>{'✕'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!!error && <Text style={[ui.error, { paddingHorizontal: 16 }]}>{error}</Text>}

      {shops === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.brand} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => String(s.id)}
          contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 150, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={
            resumeShop ? (
              <TouchableOpacity
                style={[ui.card, { backgroundColor: colors.brandSoft, borderColor: colors.brand, marginBottom: 4 }]}
                onPress={() => go('scan', { shop: resumeShop })}
              >
                <Text style={{ color: colors.brandDark, fontWeight: '700' }}>
                  Resume shopping at {resumeShop.name}
                </Text>
                <Text style={ui.muted}>
                  {resume.itemCount} item{resume.itemCount === 1 ? '' : 's'} in your bill {'·'}{' '}
                  {money(resume.totalCents)}
                </Text>
              </TouchableOpacity>
            ) : null
          }
          ListEmptyComponent={
            <Text style={[ui.muted, { textAlign: 'center', marginTop: 30 }]}>
              {query ? `No shops match "${query}"` : 'No shops available.'}
            </Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[ui.card, { flexDirection: 'row', alignItems: 'center', padding: 14 }]}
              onPress={() => go('scan', { shop: item })}
              activeOpacity={0.7}
            >
              <View
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: 14,
                  backgroundColor: colors.brandSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 12,
                }}
              >
                <Text style={{ fontSize: 28 }}>{item.icon || '🏪'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[ui.h2, { fontSize: 17 }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {!!item.tagline && (
                  <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
                    {item.tagline}
                  </Text>
                )}
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {item.address}
                  {item.productCount ? ` · ${item.productCount} items` : ''}
                </Text>
              </View>
              <Text style={{ color: colors.brand, fontSize: 24 }}>{'›'}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 16,
          paddingBottom: 10,
          paddingTop: 8,
          backgroundColor: colors.bg,
        }}
      >
        <TouchableOpacity style={ui.buttonGhost} onPress={() => go('history')}>
          <Text style={ui.buttonGhostText}>My past bills</Text>
        </TouchableOpacity>
      </View>

      <AssistantButton onPress={() => setChatOpen(true)} bottom={62} />
      <Assistant visible={chatOpen} onClose={() => setChatOpen(false)} shop={null} />
    </View>
  );
}
