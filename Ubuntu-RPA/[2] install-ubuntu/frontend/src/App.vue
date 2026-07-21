<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-200">
    <!-- Sidebar -->
    <aside class="fixed inset-y-0 left-0 w-56 bg-zinc-900 border-r border-zinc-800 flex flex-col z-30">
      <div class="px-5 py-5 border-b border-zinc-800">
        <h1 class="text-sm font-semibold tracking-widest uppercase text-zinc-300 flex items-center gap-2">
          <Bot class="w-4 h-4 text-amber-500" />
          RPA Console
        </h1>
      </div>
      <nav class="flex-1 px-3 py-4 space-y-0.5">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors"
          :class="$route.path === item.path
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'"
        >
          <component :is="item.icon" class="w-4 h-4" />
          {{ item.label }}
        </router-link>
      </nav>
      <div class="px-5 py-4 border-t border-zinc-800">
        <div class="flex items-center gap-2 text-xs font-mono">
          <span class="w-1.5 h-1.5 rounded-full" :class="healthy ? 'bg-emerald-500' : 'bg-red-500'"></span>
          <span class="text-zinc-600">{{ healthy ? 'ONLINE' : 'OFFLINE' }}</span>
        </div>
      </div>
    </aside>

    <!-- Main -->
    <main class="ml-56 p-8">
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
