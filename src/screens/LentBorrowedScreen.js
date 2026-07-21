import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
} from 'react-native';
import { TabView } from 'react-native-tab-view';
import * as Contacts from 'expo-contacts';
import { Ionicons } from '@expo/vector-icons';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';

import EmptyState from '../components/EmptyState';

import { useEPurseStore } from '../store/ePurseStore';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { INPUT_LIMITS, sanitizeName, sanitizePhone, sanitizeAmount } from '../utils/validation';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDate } from '../utils/format';
import GradientButton from '../components/GradientButton';
import CenterModal from '../components/CenterModal';
import AccountPickerSheet from '../components/AccountPickerSheet';
import WhatsAppReminderModal from '../components/WhatsAppReminderModal';
import BorrowReminderModal, { BellIconSvg } from '../components/BorrowReminderModal';
import Svg, { Path } from 'react-native-svg';

const ENTRY_LABEL = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  lent_settled: 'Received back',
  borrow_repaid: 'Repaid',
};

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

const LB_ROUTES = [
  { key: 'lent', label: 'Lent' },
  { key: 'borrowed', label: 'Borrowed' },
];

const keyToIndex = (k) => (k === 'borrowed' ? 1 : 0);
const initialLayout = { width: Dimensions.get('window').width };

// +/- direction for net contribution to "they owe me" balance
const isPositiveEntry = (kind) => kind === 'lent' || kind === 'borrow_repaid';

const LentBorrowedScreen = ({ route, navigation }) => {
  const initialKind = route?.params?.kind || 'lent';
  // Tab index is the source of truth; `kind` is the active route's key. This
  // keeps the existing kind-based logic intact while the native pager drives
  // the real swipe between the Lent and Borrowed panels.
  const [index, setIndex] = useState(() => keyToIndex(initialKind));
  const kind = LB_ROUTES[index].key;
  const setKind = useCallback((k) => setIndex(keyToIndex(k)), []);
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [contactId, setContactId] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [alreadySettled, setAlreadySettled] = useState(false); // log as already lent_settled/borrow_repaid
  const [pendingSettledAdd, setPendingSettledAdd] = useState(null); // already-repaid borrow awaiting account pick
  const [expandedPerson, setExpandedPerson] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [settleTarget, setSettleTarget] = useState(null); // borrow settle awaiting account pick
  const [reminderTarget, setReminderTarget] = useState(null);
  const [borrowReminderTarget, setBorrowReminderTarget] = useState(null);
  const [contactSheetVisible, setContactSheetVisible] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [allContacts, setAllContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);

  const all = useEPurseStore((s) => s.lentBorrowed);
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const addLentBorrowed      = useEPurseStore((s) => s.addLentBorrowed);
  const addAlreadySettledLentBorrowed = useEPurseStore((s) => s.addAlreadySettledLentBorrowed);
  const settlePersonBalance  = useEPurseStore((s) => s.settlePersonBalance);
  const getPersonBalances    = useEPurseStore((s) => s.getPersonBalances);
  const userName        = useEPurseStore((s) => s.userName);
  const notificationIds = useEPurseStore((s) => s.notificationIds);
  const groupNameById = useMemo(
    () => Object.fromEntries((groups || []).map((g) => [g.id, g.name])),
    [groups]
  );

  const resetForm = useCallback(() => {
    setPerson('');
    setPhone('');
    setContactId(null);
    setAmount('');
    setNote('');
    setAlreadySettled(false);
  }, []);

  const handleAdd = useCallback((addKind) => {
    const n = parseFloat(amount);
    if (!person.trim()) {
      setConfirm({ title: 'Missing name', message: 'Enter a person name.', primaryText: 'OK' });
      return;
    }
    if (!n || n <= 0) {
      setConfirm({ title: 'Invalid amount', message: 'Enter a positive amount.', primaryText: 'OK' });
      return;
    }
    if (n > MAX_ALLOWED_AMOUNT) {
      setConfirm({ title: 'Amount too large', message: 'Maximum allowed is ₹10,00,00,000.', primaryText: 'OK' });
      return;
    }
    const baseEntry = {
      person: person.trim(),
      amount: n,
      note: note.trim(),
      contactId: contactId ?? null,
      phone: phone.trim() || null,
    };

    if (alreadySettled) {
      // addAlreadySettledLentBorrowed creates BOTH the origin + settlement rows so
      // they net to zero. A borrow's counterpart (borrow_repaid) is a real expense —
      // pick which account it left before committing (same as the Settle flow).
      if (addKind === 'borrowed') {
        setPendingSettledAdd({ ...baseEntry, kind: 'borrowed' });
        resetForm();
        return;
      }
      addAlreadySettledLentBorrowed({ ...baseEntry, kind: 'lent' });
      resetForm();
      return;
    }

    addLentBorrowed({ ...baseEntry, kind: addKind });
    resetForm();
  }, [person, phone, contactId, amount, note, alreadySettled, addLentBorrowed, addAlreadySettledLentBorrowed, resetForm]);

  const pickContact = useCallback(async () => {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      setConfirm({
        title: 'Permission needed',
        message: 'Allow contacts access so you can pick a phone number from your list.',
        primaryText: 'OK',
      });
      return;
    }
    setContactQuery('');
    setContactSheetVisible(true);
    setContactsLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      setAllContacts(data.filter((c) => c.name && c.phoneNumbers?.length > 0));
    } catch {
      // permission revoked mid-flow or contacts unavailable
    } finally {
      setContactsLoading(false);
    }
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const base = q
      ? allContacts.filter(
          (c) =>
            c.name?.toLowerCase().includes(q) ||
            c.phoneNumbers?.some((p) => p.number?.includes(q)),
        )
      : allContacts;
    return base.slice(0, 60);
  }, [allContacts, contactQuery]);

  const handleSelectContact = useCallback((c) => {
    if (c.phoneNumbers?.length) {
      setPhone(c.phoneNumbers[0].number?.replace(/[^\d+]/g, '') || '');
      setContactId(c.id ?? null);
    }
    if (!person.trim() && c.name) setPerson(c.name);
    setContactSheetVisible(false);
  }, [person]);

  // Per-person balances for BOTH panels (both scenes are mounted by the pager).
  // lent panel shows net > 0, borrowed panel shows net < 0. Also include
  // recently-settled (net === 0) persons for up to 3 months.
  const balancesByKind = useMemo(() => {
    const nowMs = Date.now();
    const allBalances = getPersonBalances();
    const build = (k) => {
      const active = allBalances.filter((p) => (k === 'lent' ? p.net > 0 : p.net < 0));
      const recentlySettled = allBalances.filter((p) => {
        if (p.net !== 0 || !p.entries.length) return false;
        const mostRecent = Math.max(
          ...p.entries.map((e) => {
            const d = new Date(e.date).getTime();
            const s = e.settledAt ? new Date(e.settledAt).getTime() : 0;
            return Math.max(d, s);
          })
        );
        if (nowMs - mostRecent > THREE_MONTHS_MS) return false;
        const hasLent = p.entries.some((e) => e.kind === 'lent');
        const hasBorrowed = p.entries.some((e) => e.kind === 'borrowed');
        return k === 'lent' ? hasLent : (hasBorrowed && !hasLent);
      });
      return [...active, ...recentlySettled];
    };
    return { lent: build('lent'), borrowed: build('borrowed') };
  }, [getPersonBalances, all]);

  // Totals for the header (per panel).
  const totalByKind = useMemo(() => {
    const allBalances = getPersonBalances();
    return {
      lent: allBalances.filter((p) => p.net > 0).reduce((s, p) => s + p.net, 0),
      borrowed: allBalances
        .filter((p) => p.net < 0)
        .reduce((s, p) => s + Math.abs(p.net), 0),
    };
  }, [getPersonBalances, all]);
  const total = totalByKind[kind];

  const gradFor = useCallback(
    (k) =>
      k === 'lent'
        ? [colors.gradientGreenStart, colors.gradientGreenEnd]
        : [colors.gradientPurpleStart, colors.gradientPurpleEnd],
    []
  );
  const grad = gradFor(kind);

  const renderPersonCard = useCallback(
    ({ item: pb }) => {
      const isFullySettled = pb.net === 0;
      const netAbs = Math.abs(pb.net);
      const netLabel = pb.net > 0 ? 'owes you' : 'you owe';
      const netColor = pb.net > 0 ? colors.success : '#EF4444';
      const isExpanded = expandedPerson === pb.personKey;

      // Collapse all entries belonging to one group into a single cumulative line,
      // so a person who shares many group expenses shows one row per group (not per txn).
      // Non-group entries (manual IOUs, direct splits) stay individual.
      const groupAcc = {}; // groupId -> { net, date }
      const singles = [];
      pb.entries.forEach((e) => {
        if (e.groupId) {
          if (!groupAcc[e.groupId]) groupAcc[e.groupId] = { groupId: e.groupId, net: 0, date: e.date };
          const g = groupAcc[e.groupId];
          g.net += isPositiveEntry(e.kind) ? e.amount : -e.amount;
          if (new Date(e.date) > new Date(g.date)) g.date = e.date;
        } else {
          singles.push(e);
        }
      });
      const groupLines = Object.values(groupAcc)
        .filter((g) => Math.abs(g.net) > 0.005)
        .map((g) => ({
          id: `grp_${g.groupId}`,
          isGroupLine: true,
          groupName: groupNameById[g.groupId] || 'Group',
          kind: g.net > 0 ? 'lent' : 'borrowed',
          amount: Math.abs(g.net),
          date: g.date,
        }));
      const displayEntries = [...groupLines, ...singles].sort(
        (a, b) => new Date(b.date) - new Date(a.date)
      );

      const toggle = () => setExpandedPerson(isExpanded ? null : pb.personKey);

      // Settle the FULL net outstanding for this person. You owe them (net < 0) →
      // repaying is a real expense, so pick the source account. They owe you
      // (net > 0) → ledger-only confirmation.
      const handleSettlePress = () => {
        if (pb.net < 0) {
          setSettleTarget(pb);
          return;
        }
        setConfirm({
          title: 'Mark as settled?',
          message:
            `${pb.person} · ${formatCurrency(netAbs)}\n\n` +
            `Settles the FULL net outstanding of ${formatCurrency(netAbs)} ` +
            `across all groups, splits and manual entries.`,
          primaryText: 'Settle',
          destructive: true,
          secondaryText: 'Cancel',
          onSecondary: () => setConfirm(null),
          onConfirm: () => {
            settlePersonBalance(pb.personKey);
            setConfirm(null);
          },
        });
      };

      return (
        // Plain View wrapper — the header is the only touchable, so the entries
        // ScrollView below is NOT a descendant of a touchable and can scroll freely.
        <View style={[styles.personCard, isFullySettled && styles.personCardSettled]}>
          <TouchableOpacity
            style={styles.personCardHeader}
            onPress={toggle}
            activeOpacity={0.85}
          >
            <View style={[styles.avatar, isFullySettled && styles.avatarSettled]}>
              <Text style={[styles.avatarText, isFullySettled && styles.avatarTextSettled]}>
                {(pb.person || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginRight: spacing.sm }}>
              <Text
                style={[styles.name, isFullySettled && styles.nameSettled]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {pb.person || 'Unknown'}
              </Text>
              {pb.phone ? (
                <Text style={styles.personPhone} numberOfLines={1}>{pb.phone}</Text>
              ) : null}
            </View>
            {isFullySettled ? (
              <View style={styles.settledBadge}>
                <Text style={styles.settledBadgeText}>✓ Settled</Text>
              </View>
            ) : (
              <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                <Text style={[styles.netAmount, { color: netColor }]} numberOfLines={1}>
                  {formatCurrency(netAbs)}
                </Text>
                <Text style={[styles.netLabel, { color: netColor }]}>
                  {netLabel}
                </Text>
              </View>
            )}
            {!isFullySettled && pb.net > 0 ? (
              <TouchableOpacity
                style={styles.waBtn}
                onPress={(e) => {
                  e.stopPropagation?.();
                  setReminderTarget(pb);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <WAIcon />
              </TouchableOpacity>
            ) : null}
            {!isFullySettled && pb.net < 0 ? (
              <TouchableOpacity
                style={[
                  styles.bellBtn,
                  notificationIds[pb.personKey] && styles.bellBtnActive,
                ]}
                onPress={(e) => {
                  e.stopPropagation?.();
                  setBorrowReminderTarget(pb);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <BellIconSvg
                  size={14}
                  color={notificationIds[pb.personKey] ? '#6366F1' : '#6366F188'}
                />
              </TouchableOpacity>
            ) : null}
            <Text style={styles.expandArrow}>{isExpanded ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {isExpanded && (
            <>
              <ScrollView
                style={styles.entriesScroll}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                {displayEntries.map((entry) => {
                  const positive = isPositiveEntry(entry.kind);
                  const entryColor = positive ? colors.success : '#EF4444';
                  const entrySign = positive ? '+' : '−';
                  const primaryText = entry.isGroupLine
                    ? `Group · ${entry.groupName}`
                    : (entry.note && entry.note !== 'Manual settlement'
                        ? entry.note
                        : ENTRY_LABEL[entry.kind] || entry.kind);
                  const subText = entry.isGroupLine
                    ? 'Group total'
                    : `${ENTRY_LABEL[entry.kind]} · ${formatDate(entry.date)}`;

                  return (
                    <View
                      key={entry.id}
                      style={[
                        styles.entryRow,
                        entry.settledAt && styles.entrySettled,
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryNote}>{primaryText}</Text>
                        <Text style={styles.entryDate}>{subText}</Text>
                      </View>
                      <Text style={[styles.entryAmt, { color: entryColor }]}>
                        {entrySign} {formatCurrency(entry.amount)}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
              {/* Settle acts on the person's NET total, so it lives on its own
                  pinned footer row (not attached to whatever entry renders last). */}
              {!isFullySettled ? (
                <View style={styles.settleFooter}>
                  <View style={{ flex: 1, marginRight: spacing.sm }}>
                    <Text style={styles.settleFooterLabel} numberOfLines={1}>
                      {pb.net > 0 ? 'Total owed to you' : 'Total you owe'}
                    </Text>
                    <Text
                      style={[styles.settleFooterAmt, { color: netColor }]}
                      numberOfLines={1}
                    >
                      {formatCurrency(netAbs)}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.settleNetBtn} onPress={handleSettlePress}>
                    <Text style={styles.settleNetText}>Settle</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </>
          )}
        </View>
      );
    },
    [expandedPerson, settlePersonBalance, notificationIds, groupNameById]
  );

  // Form + empty state are rendered per panel (both scenes are mounted). They
  // take the panel's kind `k` so the offscreen page shows the correct copy.
  const renderForm = (k) => {
    // Heading + chip reflect the resulting category when "already settled" is on:
    // lent → Lent Settled, borrowed → Borrow Repaid.
    const settledChipLabel = k === 'lent' ? 'as Lent settled' : 'as Borrow repaid';
    const heading = alreadySettled
      ? (k === 'lent' ? 'Lent settled' : 'Borrow repaid')
      : (k === 'lent' ? 'Lend to someone' : 'Note a borrowed amount');

    return (
    <View style={styles.formCard}>
      <View style={styles.formHeaderRow}>
        <Text style={[styles.formTitle, styles.formTitleInline]}>{heading}</Text>
        {/* Toggle: log straight into the existing Lent Settled / Borrow Repaid
            categories (addAlreadySettledLentBorrowed) instead of an open
            'lent'/'borrowed' entry you'd have to Settle separately later. */}
        <TouchableOpacity
          style={[styles.settledChip, alreadySettled && styles.settledChipActive]}
          onPress={() => setAlreadySettled((v) => !v)}
          activeOpacity={0.75}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: alreadySettled }}
        >
          <View style={[styles.settledBox, alreadySettled && styles.settledBoxActive]}>
            {alreadySettled ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
          </View>
          <Text style={[styles.settledChipText, alreadySettled && styles.settledChipTextActive]}>
            {settledChipLabel}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.phoneRow}>
        <TextInput
          value={phone}
          onChangeText={(t) => { setPhone(sanitizePhone(t)); setContactId(null); }}
          placeholder="Phone number (optional)"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          style={[styles.input, styles.phoneInput]}
          maxLength={INPUT_LIMITS.PHONE_LEN}
        />
        <TouchableOpacity style={styles.contactPickBtn} onPress={pickContact}>
          <ContactPickIcon />
        </TouchableOpacity>
      </View>
      <TextInput
        value={person}
        onChangeText={(t) => setPerson(sanitizeName(t))}
        placeholder="Person name *"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={INPUT_LIMITS.NAME_MAX}
      />
      <TextInput
        value={amount}
        onChangeText={(t) => setAmount(sanitizeAmount(t))}
        keyboardType="decimal-pad"
        placeholder="Amount *"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
      />
      <TextInput
        value={note}
        onChangeText={(t) => setNote(t.slice(0, INPUT_LIMITS.NOTE_MAX))}
        placeholder="Note (optional)"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={INPUT_LIMITS.NOTE_MAX}
      />
      <GradientButton
        title="Add"
        onPress={() => handleAdd(k)}
        colors={gradFor(k)}
        style={{ marginTop: spacing.sm }}
      />
    </View>
    );
  };

  const renderEmpty = (k) => (
    <EmptyState
      icon={k === 'lent' ? 'arrow-up-circle-outline' : 'arrow-down-circle-outline'}
      title={k === 'lent' ? 'Nothing lent out' : 'Nothing borrowed'}
      subtitle={
        k === 'lent'
          ? 'Money you lend will show here so you can track what to collect.'
          : 'Money you borrow will show here so you can track what to repay.'
      }
    />
  );

  const headerComponent = (
    <CollapsingHeaderScreen
      collapsible={false}
      gradientColors={grad}
      onBack={() => navigation.goBack()}
      title={kind === 'lent' ? 'You Lent' : 'You Borrowed'}
      renderHero={() => (
        <>
          <Text style={styles.subLabel}>
            {kind === 'lent' ? 'Money to receive' : 'Money to return'}
          </Text>
          <Text style={styles.bigAmount}>{formatCurrency(total)}</Text>

          <View style={styles.toggleRow}>
            <Toggle
              label="Lent"
              active={kind === 'lent'}
              onPress={() => setKind('lent')}
            />
            <Toggle
              label="Borrowed"
              active={kind === 'borrowed'}
              onPress={() => setKind('borrowed')}
            />
          </View>
        </>
      )}
    />
  );

  const renderScene = ({ route: r }) => {
    const k = r.key;
    return (
      <View style={styles.container}>
        <FlatList
          data={balancesByKind[k]}
          keyExtractor={(item) => item.personKey}
          renderItem={renderPersonCard}
          ListHeaderComponent={renderForm(k)}
          ListEmptyComponent={renderEmpty(k)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          windowSize={7}
        />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TabView
        navigationState={{ index, routes: LB_ROUTES }}
        renderScene={renderScene}
        renderTabBar={() => headerComponent}
        onIndexChange={setIndex}
        initialLayout={initialLayout}
        swipeEnabled
      />

        <CenterModal
          visible={!!confirm}
          title={confirm?.title}
          message={confirm?.message}
          primaryText={confirm?.primaryText || 'OK'}
          destructive={!!confirm?.destructive}
          secondaryText={confirm?.secondaryText}
          onSecondary={confirm?.onSecondary}
          onClose={() => setConfirm(null)}
          onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
        />

        <AccountPickerSheet
          visible={!!settleTarget}
          title="Repay from which account?"
          subtitle={settleTarget
            ? `${settleTarget.person} · ${formatCurrency(Math.abs(settleTarget.net))} — records a Repayment expense`
            : undefined}
          accounts={accounts}
          onSelect={(accountId) => {
            settlePersonBalance(settleTarget.personKey, { accountId });
            setSettleTarget(null);
          }}
          skipLabel="Just mark repaid (no expense)"
          onSkip={() => {
            settlePersonBalance(settleTarget.personKey);
            setSettleTarget(null);
          }}
          onClose={() => setSettleTarget(null)}
        />

        <AccountPickerSheet
          visible={!!pendingSettledAdd}
          title="Repaid from which account?"
          subtitle={pendingSettledAdd
            ? `${pendingSettledAdd.person} · ${formatCurrency(pendingSettledAdd.amount)} — records a Repayment expense`
            : undefined}
          accounts={accounts}
          onSelect={(accountId) => {
            addAlreadySettledLentBorrowed(pendingSettledAdd, { accountId });
            setPendingSettledAdd(null);
          }}
          skipLabel="Just mark repaid (no expense)"
          onSkip={() => {
            addAlreadySettledLentBorrowed(pendingSettledAdd);
            setPendingSettledAdd(null);
          }}
          // Dismissing the backdrop still logs the entry (ledger-only) — the user
          // already committed to adding it by tapping "Add"; only the account
          // question was left open, so declining it shouldn't discard the entry.
          onClose={() => {
            addAlreadySettledLentBorrowed(pendingSettledAdd);
            setPendingSettledAdd(null);
          }}
        />

        <WhatsAppReminderModal
          visible={!!reminderTarget}
          person={reminderTarget?.person}
          phone={reminderTarget?.phone}
          amount={reminderTarget?.net ?? 0}
          senderName={userName}
          onClose={() => setReminderTarget(null)}
        />

        <BorrowReminderModal
          visible={!!borrowReminderTarget}
          person={borrowReminderTarget}
          onClose={() => setBorrowReminderTarget(null)}
        />

        {/* ── Contact search sheet ── */}
        <Modal
          visible={contactSheetVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setContactSheetVisible(false)}
        >
          <View style={styles.contactBackdrop}>
            <TouchableOpacity
              style={styles.contactDismiss}
              activeOpacity={1}
              onPress={() => setContactSheetVisible(false)}
            />
            <View style={styles.contactSheet}>
              <View style={styles.contactHandle} />
              <Text style={styles.contactTitle}>Pick a contact</Text>
              <TextInput
                autoFocus
                value={contactQuery}
                onChangeText={setContactQuery}
                placeholder="Search name or number…"
                placeholderTextColor={colors.textMuted}
                style={styles.contactSearch}
              />
              {contactsLoading ? (
                <ActivityIndicator
                  style={{ marginVertical: 32 }}
                  color={colors.primary}
                />
              ) : (
                <FlatList
                  data={filteredContacts}
                  keyExtractor={(c) => c.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.contactList}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.contactRow}
                      onPress={() => handleSelectContact(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.contactName}>{item.name}</Text>
                      <Text style={styles.contactPhone}>
                        {item.phoneNumbers[0].number}
                      </Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.contactEmpty}>No contacts found.</Text>
                  }
                />
              )}
            </View>
          </View>
        </Modal>
    </KeyboardAvoidingView>
  );
};

const Toggle = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.toggle, active && { backgroundColor: '#FFFFFF22' }]}
  >
    <Text
      style={[
        styles.toggleText,
        active && { color: '#fff', fontWeight: '700' },
      ]}
    >
      {label}
    </Text>
  </TouchableOpacity>
);

const ENTRY_ROW_HEIGHT = 58; // approximate height per entry row
const ENTRIES_MAX_VISIBLE = 3.5; // show 3 full + partial 4th

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, flexGrow: 1 },

  subLabel: {
    color: '#FFFFFFCC',
    ...typography.small,
    marginTop: spacing.lg,
  },
  bigAmount: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.lg,
  },
  toggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  toggleText: { color: '#FFFFFFCC', ...typography.bodyBold },

  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  formTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  formHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  formTitleInline: { flex: 1 },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  // "Already settled" chip — front-of-form toggle beside the title.
  settledChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    flexShrink: 0,
  },
  settledChipActive: {
    backgroundColor: colors.primary + '14',
    borderColor: colors.primary + '55',
  },
  settledChipText: {
    ...typography.tiny,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  settledChipTextActive: {
    color: colors.primary,
  },
  settledBox: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.textMuted,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settledBoxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  phoneInput: {
    flex: 1,
    marginBottom: 0,
  },
  contactPickBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary + '18',
    borderWidth: 1,
    borderColor: colors.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Per-person card
  personCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    ...shadows.card,
    overflow: 'hidden',
  },
  personCardSettled: {
    opacity: 0.72,
    borderWidth: 1,
    borderColor: colors.success + '33',
  },
  personCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSettled: { backgroundColor: colors.success + '18' },
  avatarText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  avatarTextSettled: { color: colors.success },
  name: { ...typography.bodyBold, color: colors.textPrimary },
  nameSettled: { color: colors.textSecondary },
  personPhone: {
    ...typography.tiny,
    color: colors.textSecondary,
    marginTop: 1,
  },
  netAmount: { ...typography.bodyBold, fontWeight: '800' },
  netLabel: { ...typography.tiny, fontWeight: '600', marginTop: 1 },
  expandArrow: { color: colors.textSecondary, fontSize: 10, marginLeft: 4 },
  waBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#25D36618',
    borderWidth: 1,
    borderColor: '#25D36633',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  bellBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#6366F112',
    borderWidth: 1,
    borderColor: '#6366F130',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  bellBtnActive: {
    backgroundColor: '#6366F128',
    borderColor: '#6366F166',
  },
  settledBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    backgroundColor: colors.success + '18',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success + '44',
  },
  settledBadgeText: {
    color: colors.success,
    ...typography.tiny,
    fontWeight: '700',
  },

  entriesScroll: {
    maxHeight: ENTRY_ROW_HEIGHT * ENTRIES_MAX_VISIBLE,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  entrySettled: { opacity: 0.55 },
  entryNote: { ...typography.small, color: colors.textPrimary },
  entryDate: { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },
  entryAmt: { ...typography.bodyBold, fontWeight: '700' },

  settleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  settleFooterLabel: { ...typography.tiny, color: colors.textSecondary },
  settleFooterAmt: { ...typography.bodyBold, fontWeight: '700', marginTop: 1 },

  settleNetBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: colors.success + '18',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success + '44',
    flexShrink: 0,
  },
  settleNetText: {
    color: colors.success,
    ...typography.tiny,
    fontWeight: '700',
  },
  settle: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary + '15',
    borderRadius: radius.pill,
  },
  settleText: {
    color: colors.primary,
    ...typography.tiny,
    fontWeight: '700',
  },
  settledPill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    backgroundColor: colors.textMuted + '22',
    borderRadius: radius.pill,
  },
  settledPillText: {
    color: colors.textSecondary,
    ...typography.tiny,
    fontWeight: '700',
  },

  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  // ── Contact search sheet ────────────────────────────────────────────────
  contactBackdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  contactDismiss: { flex: 1 },
  contactSheet: {
    backgroundColor:      colors.card,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    paddingHorizontal:    20,
    paddingBottom:        32,
    maxHeight:            '75%',
  },
  contactHandle: {
    width:           36,
    height:          4,
    borderRadius:    2,
    backgroundColor: colors.divider,
    alignSelf:       'center',
    marginTop:       10,
    marginBottom:    14,
  },
  contactTitle: {
    ...typography.h2,
    fontWeight:   '700',
    color:        colors.textPrimary,
    marginBottom: spacing.sm,
  },
  contactSearch: {
    ...typography.body,
    color:           colors.textPrimary,
    borderWidth:     1.5,
    borderColor:     colors.divider,
    borderRadius:    radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical:   10,
    marginBottom:    spacing.sm,
    backgroundColor: colors.background,
  },
  contactList: { maxHeight: 380 },
  contactRow: {
    paddingVertical:   12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  contactName: {
    ...typography.bodyBold,
    fontWeight: '600',
    color:      colors.textPrimary,
  },
  contactPhone: {
    ...typography.small,
    color:     colors.textSecondary,
    marginTop: 2,
  },
  contactEmpty: {
    ...typography.body,
    color:     colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});

const ContactPickIcon = ({ size = 18 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
      fill={colors.primary}
    />
  </Svg>
);

const WAIcon = ({ size = 17 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
      fill="#25D366"
    />
    <Path
      d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.304A9.96 9.96 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.958 7.958 0 0 1-4.078-1.117l-.292-.173-3.03.794.808-2.951-.19-.303A7.96 7.96 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"
      fill="#25D366"
    />
  </Svg>
);

export default LentBorrowedScreen;
