<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-lg font-semibold text-zinc-300 uppercase tracking-wider">Deployments</h2>
      <button
        @click="refresh"
        class="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
      >
        <RefreshCw class="w-3.5 h-3.5" />
        REFRESH
      </button>
    </div>

    <div v-if="store.deployments.length === 0 && !store.loading" class="text-center py-12 text-zinc-600">
      <Boxes class="w-10 h-10 mx-auto mb-3 text-zinc-700" />
      <p class="font-mono text-sm">No deployments</p>
      <p class="text-xs mt-1 text-zinc-700 font-mono">Run must_deploy.py on Worker</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      <div
        v-for="dep in store.deployments"
        :key="dep.id"
        class="bg-zinc-900 border border-zinc-800 rounded p-4 hover:border-amber-600/40 hover:shadow-lg hover:shadow-amber-950/20 transition-all duration-150"
      >
        <!-- Header -->
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="font-medium text-zinc-200 text-sm">{{ dep.name }}</h3>
            <p class="text-xs text-zinc-600 font-mono mt-0.5">{{ dep.id?.slice(0, 12) }}</p>
          </div>
          <span
            class="px-1.5 py-0.5 rounded text-xs font-mono uppercase"
            :class="dep.is_schedule_active ? 'bg-emerald-950/50 text-emerald-500' : 'bg-zinc-800 text-zinc-600'"
          >
            {{ dep.is_schedule_active ? 'AUTO' : 'MANUAL' }}
          </span>
        </div>

        <!-- Info -->
        <div class="space-y-1.5 mb-4">
          <div class="flex items-center gap-2 text-xs font-mono text-zinc-500" v-if="dep.work_pool_name">
            <Server class="w-3.5 h-3.5 text-zinc-600" />
            {{ dep.work_pool_name }}
          </div>
          <div class="flex items-center gap-2 text-xs font-mono text-zinc-500" v-if="dep.schedule?.cron">
            <Clock class="w-3.5 h-3.5 text-zinc-600" />
            {{ dep.schedule.cron }}
          </div>
          <div class="flex flex-wrap gap-1" v-if="dep.tags?.length">
            <span
              v-for="tag in dep.tags"
              :key="tag"
              class="bg-zinc-800 text-zinc-500 text-xs font-mono px-1.5 py-0.5 rounded"
            >{{ tag }}</span>
          </div>
        </div>

        <!-- Trigger Button -->
        <button
          @click="triggerDeployment(dep)"
          :disabled="triggering === dep.id"
          class="w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-600 text-zinc-950 rounded text-xs font-mono font-semibold uppercase tracking-wider hover:bg-amber-500 disabled:opacity-50 transition-colors"
        >
          <Play class="w-3.5 h-3.5" />
          {{ triggering === dep.id ? 'SENDING...' : 'TRIGGER' }}
        </button>
      </div>
    </div>

    <!-- Trigger Success/Error Toast -->
    <div
      v-if="toast.show"
      class="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded border text-xs font-mono font-medium transition-all"
      :class="toast.type === 'success' ? 'bg-emerald-950 border-emerald-800 text-emerald-400' : 'bg-red-950 border-red-800 text-red-400'"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { RefreshCw, Boxes, Play, Server, Clock } from 'lucide-vue-next'
import { useJobsStore } from '../stores/jobs'

const store = useJobsStore()
const triggering = ref(null)
const toast = reactive({ show: false, message: '', type: 'success' })

function showToast(message, type = 'success') {
  toast.show = true
  toast.message = message
  toast.type = type
  setTimeout(() => { toast.show = false }, 3000)
}

async function triggerDeployment(dep) {
  triggering.value = dep.id
  try {
    const result = await store.triggerJob(dep.name)
    showToast(`Job triggered: ${result.flow_run_id.slice(0, 8)}`, 'success')
  } catch (e) {
    showToast(`Failed: ${e.message}`, 'error')
  } finally {
    triggering.value = null
  }
}

let refreshTimer = null

function refresh() {
  store.fetchDeployments()
}

onMounted(() => {
  store.fetchDeployments()
  refreshTimer = setInterval(() => store.fetchDeployments(), 30000)
})

onUnmounted(() => {
  clearInterval(refreshTimer)
})
</script>
