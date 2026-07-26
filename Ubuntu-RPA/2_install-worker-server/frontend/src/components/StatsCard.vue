<template>
  <div
    class="bg-zinc-900 border border-zinc-800 rounded p-4 flex items-center gap-4 cursor-pointer hover:border-zinc-600 hover:-translate-y-0.5 transition-all duration-150"
    @click="$emit('click')"
  >
    <div class="p-2.5 rounded bg-zinc-800">
      <component :is="icon" class="w-5 h-5" :class="iconClass" />
    </div>
    <div>
      <p class="text-2xl font-semibold font-mono text-zinc-100">{{ value }}</p>
      <p class="text-xs text-zinc-500 uppercase tracking-wide">{{ label }}</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: Object, required: true },
  value: { type: [Number, String], required: true },
  label: { type: String, required: true },
  bgClass: { type: String, default: '' },
  iconClass: { type: String, default: 'text-zinc-400' },
})
</script>
