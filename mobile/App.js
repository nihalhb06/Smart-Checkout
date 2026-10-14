import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, setToken, setUnauthorizedHandler } from './src/api';
import { ThemeProvider, useTheme } from './src/theme';
import AuthScreen from './src/screens/AuthScreen';
import ShopsScreen from './src/screens/ShopsScreen';
import ScanScreen from './src/screens/ScanScreen';
import PaymentScreen from './src/screens/PaymentScreen';
import ReceiptScreen from './src/screens/ReceiptScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const SESSION_KEY = 'session';

export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </ThemeProvider>
  );
}

function Root() {
  const { colors, ui, isDark } = useTheme();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState({ name: 'shops' });

  const go = useCallback((name, params = {}) => setRoute({ name, ...params }), []);

  const logout = useCallback(async () => {
    setToken(null);
    setUser(null);
    setRoute({ name: 'shops' });
    try {
      await AsyncStorage.removeItem(SESSION_KEY);
    } catch {}
  }, []);

  const login = useCallback(async ({ token, user: u }) => {
    setToken(token);
    setUser(u);
    setRoute({ name: 'shops' });
    try {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ token }));
    } catch {}
  }, []);

  // Restore a saved session.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    (async () => {
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(SESSION_KEY)) || 'null');
        if (saved?.token) {
          setToken(saved.token);
          const { user: u } = await api.get('/auth/me');
          if (u.role === 'customer') setUser(u);
          else setToken(null);
        }
      } catch {
        setToken(null);
      }
      setReady(true);
    })();
  }, [logout]);

  // Android hardware back button.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!user) return false;
      if (route.name === 'scan' || route.name === 'history' || route.name === 'profile') {
        setRoute({ name: 'shops' });
        return true;
      }
      if (route.name === 'receipt') {
        setRoute(route.from === 'history' ? { name: 'history' } : { name: 'shops' });
        return true;
      }
      return false; // payment screen handles its own back; shops exits the app
    });
    return () => sub.remove();
  }, [user, route]);

  if (!ready) {
    return (
      <View style={[ui.screen, { justifyContent: 'center' }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  let screen;
  if (!user) screen = <AuthScreen onLogin={login} />;
  else if (route.name === 'scan') screen = <ScanScreen shop={route.shop} go={go} />;
  else if (route.name === 'payment')
    screen = <PaymentScreen payment={route.payment} cart={route.cart} shop={route.shop} go={go} />;
  else if (route.name === 'receipt') screen = <ReceiptScreen bill={route.bill} from={route.from} go={go} />;
  else if (route.name === 'history') screen = <HistoryScreen go={go} />;
  else if (route.name === 'profile') screen = <ProfileScreen user={user} go={go} onLogout={logout} />;
  else screen = <ShopsScreen user={user} go={go} onLogout={logout} openAssistant={route.openAssistant} />;

  return (
    <SafeAreaView style={ui.screen}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {screen}
    </SafeAreaView>
  );
}
