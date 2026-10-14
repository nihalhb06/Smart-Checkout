import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { API_URL } from '../config';
import { useTheme } from '../theme';

export default function AuthScreen({ onLogin }) {
  const { colors, ui } = useTheme();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const body = mode === 'login' ? { email, password } : { name, email, password };
      const data = await api.post(`/auth/${mode === 'login' ? 'login' : 'register'}`, body);
      if (data.user.role !== 'customer') {
        throw new Error('Staff accounts use the web dashboard at /staff, not this app.');
      }
      await onLogin(data);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[ui.pad, { flexGrow: 1, justifyContent: 'center' }]} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 44, textAlign: 'center' }}>{'🛒'}</Text>
        <Text style={[ui.h1, { textAlign: 'center', marginBottom: 4 }]}>Smart Checkout</Text>
        <Text style={[ui.muted, { textAlign: 'center', marginBottom: 28 }]}>Scan, shop and pay - no queues.</Text>

        {mode === 'register' && (
          <TextInput
            style={ui.input}
            placeholder="Full name"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
        )}
        <TextInput
          style={ui.input}
          placeholder="Email"
          placeholderTextColor={colors.muted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <TextInput
          style={ui.input}
          placeholder="Password (min 6 characters)"
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          onSubmitEditing={submit}
        />
        {!!error && <Text style={ui.error}>{error}</Text>}

        <TouchableOpacity style={[ui.button, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          style={ui.buttonGhost}
          onPress={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          <Text style={ui.buttonGhostText}>
            {mode === 'login' ? "New here? Create an account" : 'Already have an account? Log in'}
          </Text>
        </TouchableOpacity>

        <View style={{ marginTop: 24 }}>
          <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>Server: {API_URL}</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
