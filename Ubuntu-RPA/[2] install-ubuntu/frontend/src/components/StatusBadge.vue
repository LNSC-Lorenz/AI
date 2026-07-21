<template>
  <span
    class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono font-medium uppercase tracking-wider"
    :class="badgeClass"
  >
    <span class="w-1.5 h-1.5 rounded-full" :class="dotClass"></span>
    {{ label }}
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, required: true },
})

const config = {
  COMPLETED: { bg: 'bg-emerald-950/50 text-emerald-400', dot: 'bg-emerald-500', label: 'OK' },
  FAILED:    { bg: 'bg-red-950/50 text-red-400',         dot: 'bg-red-500',     label: 'FAIL' },
  RUNNING:   { bg: 'bg-amber-950/50 text-amber-400',     dot: 'bg-amber-500 animate-pulse', label: 'RUN' },
  PENDING:   { bg: 'bg-zinc-800 text-zinc-400',           dot: 'bg-zinc-500',    label: 'WAIT' },
  SCHEDULED: { bg: 'bg-zinc-800 text-zinc-400',           dot: 'bg-zinc-500',    label: 'SCHED' },
  CANCELLED: { bg: 'bg-zinc-800 text-zinc-600',           dot: 'bg-zinc-600',    label: 'CANCEL' },
  CANCELLING:{ bg: 'bg-zinc-800 text-zinc-600',           dot: 'bg-zinc-600',    label: 'CANCEL' },
  CRASHED:   { bg: 'bg-red-950/50 text-red-400',          dot: 'bg-red-500',     label: 'CRASH' },
}

const entry = computed(() => config[props.status] || { bg: 'bg-zinc-800 text-zinc-500', dot: 'bg-zinc-600', label: props.status })
const badgeClass = computed(() => entry.value.bg)
const dotClass = computed(() => entry.value.dot)
const label = computed(() => entry.value.label)
</script>
