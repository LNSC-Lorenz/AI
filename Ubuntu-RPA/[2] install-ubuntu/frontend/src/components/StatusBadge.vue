<template>
  <span
    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
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
  COMPLETED: { bg: 'bg-green-50 text-green-700', dot: 'bg-green-500', label: 'Completed' },
  FAILED:    { bg: 'bg-red-50 text-red-700',     dot: 'bg-red-500',   label: 'Failed' },
  RUNNING:   { bg: 'bg-blue-50 text-blue-700',   dot: 'bg-blue-500 animate-pulse', label: 'Running' },
  PENDING:   { bg: 'bg-yellow-50 text-yellow-700', dot: 'bg-yellow-500', label: 'Pending' },
  SCHEDULED: { bg: 'bg-purple-50 text-purple-700', dot: 'bg-purple-500', label: 'Scheduled' },
  CANCELLED: { bg: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400',   label: 'Cancelled' },
  CANCELLING:{ bg: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400',   label: 'Cancelling' },
  CRASHED:   { bg: 'bg-red-50 text-red-700',       dot: 'bg-red-500',    label: 'Crashed' },
}

const entry = computed(() => config[props.status] || { bg: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400', label: props.status })
const badgeClass = computed(() => entry.value.bg)
const dotClass = computed(() => entry.value.dot)
const label = computed(() => entry.value.label)
</script>
