import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { api } from '../api';
import { money, useTheme } from '../theme';

let nextId = 1;
const makeMsg = (from, data) => ({ id: nextId++, from, ...data });

/** Renders the **bold** spans the assistant uses, keeping everything else as plain text. */
function RichText({ children, style }) {
  const parts = String(children).split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <Text key={i} style={{ fontWeight: '800' }}>
            {part.slice(2, -2)}
          </Text>
        ) : (
          part
        )
      )}
    </Text>
  );
}

/** Floating chat button. Sits above whatever screen renders it. */
export function AssistantButton({ onPress, bottom = 86 }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel="Open the shopping assistant"
      style={{
        position: 'absolute',
        right: 16,
        bottom,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.brand,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 999,
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
      }}
    >
      <Text style={{ fontSize: 17 }}>{'💬'}</Text>
      <Text style={{ color: '#fff', fontWeight: '700', marginLeft: 8 }}>Ask</Text>
    </TouchableOpacity>
  );
}

export default function Assistant({ visible, onClose, shop }) {
  const { colors, ui } = useTheme();
  const [messages, setMessages] = useState([]);
  const [chips, setChips] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);

  const scrollToEnd = () => requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

  // Fresh greeting each time the sheet opens, so the chips always match the current shop.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setMessages([]);
    setChips([]);
    api
      .get(`/assistant/intro${shop ? `?shopId=${shop.id}` : ''}`)
      .then((d) => {
        if (cancelled) return;
        setMessages([makeMsg('bot', { text: d.reply })]);
        setChips(d.suggestions || []);
      })
      .catch(() => {
        if (!cancelled) setMessages([makeMsg('bot', { text: "I'm having trouble reaching the server right now." })]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, shop]);

  const send = useCallback(
    async (text) => {
      const message = String(text || '').trim();
      if (!message || busy) return;
      setDraft('');
      setChips([]);
      setMessages((m) => [...m, makeMsg('me', { text: message })]);
      setBusy(true);
      scrollToEnd();
      try {
        const d = await api.post('/assistant', { message, shopId: shop?.id });
        setMessages((m) => [...m, makeMsg('bot', { text: d.reply, products: d.products })]);
        setChips(d.suggestions || []);
      } catch (e) {
        setMessages((m) => [...m, makeMsg('bot', { text: e.message })]);
      } finally {
        setBusy(false);
        scrollToEnd();
      }
    },
    [busy, shop]
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            height: '86%',
            backgroundColor: colors.bg,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: 14,
              backgroundColor: colors.card,
              borderBottomWidth: 1,
              borderBottomColor: colors.line,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: colors.brandSoft,
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 10,
              }}
            >
              <Text style={{ fontSize: 19 }}>{'🤖'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={ui.h3}>Shopping assistant</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {shop ? `Helping you at ${shop.name}` : 'Ask about the app or a shop'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={{ color: colors.muted, fontSize: 22 }}>{'✕'}</Text>
            </TouchableOpacity>
          </View>

          {/* Conversation */}
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ padding: 14, paddingBottom: 6 }}
            onContentSizeChange={scrollToEnd}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <Bubble msg={item} />}
            ListFooterComponent={
              busy ? (
                <View
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: colors.bubbleBot,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.line,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                >
                  <ActivityIndicator size="small" color={colors.brand} />
                </View>
              ) : null
            }
          />

          {/* Suggestion chips */}
          {chips.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 8 }}
            >
              {chips.map((c) => (
                <TouchableOpacity key={c} style={[ui.pill, { borderColor: colors.brand }]} onPress={() => send(c)}>
                  <Text style={{ color: colors.brand, fontWeight: '600', fontSize: 13 }}>{c}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Composer */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              padding: 10,
              gap: 8,
              backgroundColor: colors.card,
              borderTopWidth: 1,
              borderTopColor: colors.line,
            }}
          >
            <TextInput
              style={[ui.input, { flex: 1, marginBottom: 0, maxHeight: 110 }]}
              placeholder={shop ? `Ask about ${shop.name}…` : 'Ask me anything…'}
              placeholderTextColor={colors.muted}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => send(draft)}
              returnKeyType="send"
              multiline
            />
            <TouchableOpacity
              style={[ui.button, { paddingHorizontal: 18, paddingVertical: 13 }, (!draft.trim() || busy) && { opacity: 0.5 }]}
              onPress={() => send(draft)}
              disabled={!draft.trim() || busy}
            >
              <Text style={ui.buttonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Bubble({ msg }) {
  const { colors, ui } = useTheme();
  const mine = msg.from === 'me';
  return (
    <View style={{ marginBottom: 10, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '88%',
          backgroundColor: mine ? colors.bubbleUser : colors.bubbleBot,
          borderWidth: mine ? 0 : 1,
          borderColor: colors.line,
          borderRadius: 16,
          borderBottomRightRadius: mine ? 4 : 16,
          borderBottomLeftRadius: mine ? 16 : 4,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <RichText style={{ color: mine ? '#fff' : colors.ink, fontSize: 15, lineHeight: 21 }}>{msg.text}</RichText>
      </View>

      {/* Location cards for product answers */}
      {!mine &&
        msg.products?.map((p) => (
          <View
            key={p.barcode}
            style={[
              ui.card,
              {
                marginTop: 8,
                padding: 12,
                flexDirection: 'row',
                alignItems: 'center',
                maxWidth: '88%',
                backgroundColor: colors.cardAlt,
                borderColor: colors.brand,
              },
            ]}
          >
            <Text style={{ fontSize: 20, marginRight: 10 }}>{'📍'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.ink }} numberOfLines={2}>
                {p.name}
              </Text>
              <Text style={{ color: colors.brandDark, fontWeight: '600', fontSize: 13 }}>
                {[p.aisle, p.shelf].filter(Boolean).join(' · ')}
              </Text>
              {!!p.section && <Text style={{ color: colors.muted, fontSize: 12 }}>{p.section}</Text>}
            </View>
            <Text style={{ fontWeight: '800', color: colors.ink }}>{money(p.priceCents)}</Text>
          </View>
        ))}
    </View>
  );
}
