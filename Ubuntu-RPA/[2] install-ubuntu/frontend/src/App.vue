<template>
  <div class="min-h-screen bg-gray-50">
    <!-- Sidebar -->
    <aside class="fixed inset-y-0 left-0 w-60 bg-slate-900 text-white flex flex-col z-30">
      <div class="px-5 py-6 border-b border-slate-700">
        <h1 class="text-xl font-bold tracking-tight flex items-center gap-2">
          <Bot class="w-6 h-6 text-blue-400" />
          RPA Platform
        </h1>
        <p class="text-xs text-slate-400 mt-1">Job Orchestration Console</p>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-1">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors"
          :class="$route.path === item.path
            ? 'bg-blue-600 text-white'
            : 'text-slate-300 hover:bg-slate-800 hover:text-white'"
        >
          <component :is="item.icon" class="w-5 h-5" />
          {{ item.label }}
        </router-link>
      </nav>
      <div class="px-5 py-4 border-t border-slate-700">
        <div class="flex items-center gap-2 text-xs">
          <span class="w-2 h-2 rounded-full" :class="healthy ? 'bg-green-400' : 'bg-red-400'"></span>
          <span class="text-slate-400">{{ healthy ? 'System Online' : 'System Offline' }}</span>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <main class="ml-60 p-8">
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { LayoutDashboard, PlayCircle, Boxes, Bot } from 'lucide-vue-next'
import api from './api'

const healthy = ref(false)

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/jobs', label: 'Jobs', icon: PlayCircle },
  { path: '/deployments', label: 'Deployments', icon: Boxes },
]

onMounted(async () => {
  try {
    await api.getHealth()
    healthy.value = true
  } catch {
    healthy.value = false
  }
})
</script>
