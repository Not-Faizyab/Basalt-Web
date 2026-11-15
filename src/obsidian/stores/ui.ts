"use client"

// ─── UI store: modals, find bar, hover preview, search box state ─────────────
import { create } from "zustand"

export interface RenameTarget {
  kind: "note" | "folder"
  id: string
  currentName: string
}

export interface FindRequest {
  tabId: string
  nonce: number
  query?: string
  showReplace?: boolean
}

export interface ExtractRequest {
  tabId: string
  nonce: number
  blockIndex: number
  text: string
}

export interface MoveTarget {
  kind: "note" | "folder"
  id: string
  currentName: string
}

export interface MergeTarget {
  noteId: string
  noteName: string
}

export interface ConfirmState {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

export interface PromptState {
  title: string
  message?: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  onSubmit: (value: string) => void | Promise<void>
}

interface UiState {
  paletteOpen: boolean
  switcherOpen: boolean
  settingsOpen: boolean
  settingsSection: string
  vaultPickerOpen: boolean
  templateOpen: boolean
  renameTarget: RenameTarget | null
  moveTarget: MoveTarget | null
  mergeTarget: MergeTarget | null
  confirmState: ConfirmState | null
  promptState: PromptState | null
  findRequest: FindRequest | null
  extractRequest: ExtractRequest | null
  searchQuery: string
  searchCaseSensitive: boolean
  slidesActive: boolean
  workspacesOpen: boolean
  snapshotsOpen: boolean
  /** when set, the snapshots modal is filtered to this note ("Open version history") */
  snapshotsNote: string | null

  openPalette: () => void
  openSwitcher: () => void
  openSettings: (section?: string) => void
  openVaultPicker: () => void
  openTemplateModal: () => void
  openRename: (target: RenameTarget) => void
  openMove: (target: MoveTarget) => void
  openMerge: (noteId: string, noteName?: string) => void
  openConfirm: (state: ConfirmState) => void
  openPrompt: (state: PromptState) => void
  requestFind: (tabId: string, opts?: { query?: string; showReplace?: boolean }) => void
  requestExtract: (tabId: string, blockIndex: number, text: string) => void
  setSearchQuery: (q: string) => void
  toggleSearchCase: () => void
  startSlides: () => void
  stopSlides: () => void
  openWorkspaces: () => void
  openSnapshots: (noteId?: string) => void
  closeAllModals: () => void
}

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  switcherOpen: false,
  settingsOpen: false,
  settingsSection: "appearance",
  vaultPickerOpen: false,
  templateOpen: false,
  renameTarget: null,
  moveTarget: null,
  mergeTarget: null,
  confirmState: null,
  promptState: null,
  findRequest: null,
  extractRequest: null,
  searchQuery: "",
  searchCaseSensitive: false,
  slidesActive: false,
  workspacesOpen: false,
  snapshotsOpen: false,
  snapshotsNote: null,

  openPalette: () => set({ paletteOpen: true, switcherOpen: false }),
  openSwitcher: () => set({ switcherOpen: true, paletteOpen: false }),
  openSettings: (section = "appearance") => set({ settingsOpen: true, settingsSection: section }),
  openVaultPicker: () => set({ vaultPickerOpen: true }),
  openTemplateModal: () => set({ templateOpen: true }),
  openRename: (target) => set({ renameTarget: target }),
  openMove: (target) => set({ moveTarget: target }),
  openMerge: (noteId, noteName) => set({ mergeTarget: { noteId, noteName: noteName ?? "" } }),
  openConfirm: (confirmState) => set({ confirmState }),
  openPrompt: (promptState) => set({ promptState }),
  requestFind: (tabId, opts) => set({ findRequest: { tabId, nonce: Date.now(), query: opts?.query, showReplace: opts?.showReplace } }),
  requestExtract: (tabId, blockIndex, text) => set({ extractRequest: { tabId, nonce: Date.now(), blockIndex, text } }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  toggleSearchCase: () => set({ searchCaseSensitive: !get().searchCaseSensitive }),
  startSlides: () => set({ slidesActive: true }),
  stopSlides: () => set({ slidesActive: false }),
  openWorkspaces: () => set({ workspacesOpen: true }),
  openSnapshots: (noteId) => set({ snapshotsOpen: true, snapshotsNote: noteId ?? null }),
  closeAllModals: () =>
    set({
      paletteOpen: false,
      switcherOpen: false,
      settingsOpen: false,
      vaultPickerOpen: false,
      templateOpen: false,
      renameTarget: null,
      moveTarget: null,
      mergeTarget: null,
      confirmState: null,
      promptState: null,
      workspacesOpen: false,
      snapshotsOpen: false,
      snapshotsNote: null,
    }),
}))
