import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../api';
import { formatDate, money, useTheme } from '../theme';

export default function HistoryScreen({ go }) {
  const { colors, ui } = useTheme();
  const [bills, setBills] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setBills((await api.get('/bills')).bills);
    } catch (e) {
      setError(e.message);
      setBills((prev) => prev || []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
        <TouchableOpacity onPress={() => go('shops')} hitSlop={12}>
          <Text style={{ color: colors.brand, fontSize: 16, fontWeight: '600' }}>{'‹'} Shops</Text>
        </TouchableOpacity>
        <Text style={[ui.h2, { flex: 1, textAlign: 'center', marginRight: 50 }]}>My bills</Text>
      </View>
      {!!error && <Text style={[ui.error, { paddingHorizontal: 20 }]}>{error}</Text>}
      {bills === null ? (
        <ActivityIndicator style={{ marginTop: 40 }} size="large" color={colors.brand} />
      ) : (
        <FlatList
          data={bills}
          keyExtractor={(b) => b.code}
          contentContainerStyle={{ padding: 16, paddingTop: 0 }}
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
          ListEmptyComponent={<Text style={[ui.muted, { textAlign: 'center', marginTop: 30 }]}>No bills yet.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[ui.card, { marginBottom: 10, flexDirection: 'row', alignItems: 'center' }]}
              onPress={() => go('receipt', { bill: item, from: 'history' })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.ink }}>{item.shopName}</Text>
                <Text style={{ fontFamily: undefined, color: colors.brandDark, fontWeight: '600' }}>{item.code}</Text>
                <Text style={ui.muted}>
                  {formatDate(item.paidAt)} {'·'} {item.itemCount} item{item.itemCount === 1 ? '' : 's'}
                </Text>
              </View>
              <Text style={{ fontWeight: '800', fontSize: 16, color: colors.ink }}>{money(item.totalCents)}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
