<template>
  <div class="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4 shadow-sm">
    <div class="p-3 rounded-lg" :class="bgClass">
      <component :is="icon" class="w-6 h-6" :class="iconClass" />
    </div>
    <div>
      <p class="text-2xl font-bold text-gray-900">{{ value }}</p>
      <p class="text-sm text-gray-500">{{ label }}</p>
    </div>
  </div>
</template>

<script setup>
defineProps({
  icon: { type: Object, required: true },
  value: { type: [Number, String], required: true },
  label: { type: String, required: true },
  bgClass: { type: String, default: 'bg-blue-50' },
  iconClass: { type: String, default: 'text-blue-600' },
})
</script>
