import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LIGHT = {
  dark: false,
  bg: '#f4f6fb',
  card: '#ffffff',
  cardAlt: '#eef0ff',
  ink: '#1c2333',
  muted: '#667085',
  line: '#e4e7ec',
  brand: '#4f46e5',
  brandDark: '#3730a3',
  brandSoft: '#eef0ff',
  ok: '#1a9d58',
  okSoft: '#e6f7ee',
  warn: '#b54708',
  warnSoft: '#fff4e5',
  danger: '#d92d20',
  chip: '#ffffff',
  overlay: 'rgba(16,20,32,0.45)',
  bubbleBot: '#ffffff',
  bubbleUser: '#4f46e5',
  scanner: '#111318',
};

const DARK = {
  dark: true,
  bg: '#0f1218',
  card: '#191d26',
  cardAlt: '#20263a',
  ink: '#f2f4f8',
  muted: '#98a2b3',
  line: '#2a3040',
  brand: '#8b85ff',
  brandDark: '#b5b1ff',
  brandSoft: '#232946',
  ok: '#3ddc91',
  okSoft: '#13301f',
  warn: '#fdb022',
  warnSoft: '#33240c',
  danger: '#ff6b5e',
  chip: '#20263a',
  overlay: 'rgba(0,0,0,0.6)',
  bubbleBot: '#191d26',
  bubbleUser: '#4f46e5',
  scanner: '#05070b',
};

export const money = (cents) => '₹' + (cents / 100).toFixed(2);

export const formatDate = (iso) => new Date(iso).toLocaleString();

export const formatDay = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function makeUi(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    pad: { padding: 20 },
    h1: { fontSize: 28, fontWeight: '700', color: colors.ink },
    h2: { fontSize: 20, fontWeight: '700', color: colors.ink },
    h3: { fontSize: 15, fontWeight: '700', color: colors.ink },
    text: { color: colors.ink },
    muted: { color: colors.muted },
    card: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.line,
    },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.ink,
      marginBottom: 12,
    },
    button: {
      backgroundColor: colors.brand,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    buttonGhost: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
    buttonGhostText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
    error: { color: colors.danger, marginBottom: 10 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    pill: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.chip,
    },
  });
}

// Both variants are built once, so switching mode never rebuilds stylesheets.
const THEMES = {
  light: { colors: LIGHT, ui: makeUi(LIGHT) },
  dark: { colors: DARK, ui: makeUi(DARK) },
};

const MODE_KEY = 'themeMode'; // 'system' | 'light' | 'dark'

const ThemeContext = createContext({
  ...THEMES.light,
  mode: 'system',
  setMode: () => {},
  isDark: false,
});

export function ThemeProvider({ children }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState('system');

  useEffect(() => {
    AsyncStorage.getItem(MODE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') setModeState(saved);
      })
      .catch(() => {});
  }, []);

  const value = useMemo(() => {
    const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
    const setMode = (next) => {
      setModeState(next);
      AsyncStorage.setItem(MODE_KEY, next).catch(() => {});
    };
    return { ...(isDark ? THEMES.dark : THEMES.light), mode, setMode, isDark };
  }, [mode, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
