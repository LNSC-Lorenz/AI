<template>
  <div>
    <!-- Back -->
    <button
      @click="$router.push('/jobs')"
      class="flex items-center gap-1 text-xs font-mono text-zinc-600 hover:text-zinc-400 mb-4 transition-colors"
    >
      <ArrowLeft class="w-3.5 h-3.5" /> BACK
    </button>

    <div v-if="loading" class="text-center py-12 text-zinc-600 font-mono text-sm">Loading...</div>

    <template v-else-if="job">
      <!-- Header -->
      <div class="bg-zinc-900 border border-zinc-800 rounded p-5 mb-4">
        <div class="flex justify-between items-start">
          <div>
            <h2 class="text-lg font-semibold text-zinc-200 mb-1">{{ job.name || 'Unnamed Job' }}</h2>
            <p class="text-xs text-zinc-600 font-mono">{{ job.id }}</p>
          </div>
          <StatusBadge :status="job.state?.type || 'PENDING'" />
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-zinc-800">
          <div>
            <p class="text-xs font-mono text-zinc-600 uppercase mb-1">Flow</p>
            <p class="text-sm font-mono text-zinc-400">{{ job.flow_id?.slice(0, 12) || '-' }}</p>
          </div>
          <div>
            <p class="text-xs font-mono text-zinc-600 uppercase mb-1">Deployment</p>
            <p class="text-sm font-mono text-zinc-400">{{ job.deployment_id?.slice(0, 12) || '-' }}</p>
          </div>
          <div>
            <p class="text-xs font-mono text-zinc-600 uppercase mb-1">Start</p>
            <p class="text-sm font-mono text-zinc-400">{{ formatFull(job.start_time) }}</p>
          </div>
          <div>
            <p class="text-xs font-mono text-zinc-600 uppercase mb-1">Duration</p>
            <p class="text-sm font-mono text-zinc-400">{{ formatDuration(job.start_time, job.end_time) }}</p>
          </div>
        </div>
      </div>

      <!-- Tags -->
      <div v-if="job.tags?.length" class="mb-4">
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in job.tags"
            :key="tag"
            class="bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded text-xs font-mono"
          >{{ tag }}</span>
        </div>
      </div>

      <!-- Parameters -->
      <div v-if="job.parameters && Object.keys(job.parameters).length > 0" class="bg-zinc-900 border border-zinc-800 rounded p-5 mb-4">
        <h3 class="text-xs font-mono text-zinc-600 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Settings class="w-3.5 h-3.5" /> Parameters
        </h3>
        <div class="bg-zinc-950 border border-zinc-800 rounded p-4 font-mono text-sm text-zinc-400 overflow-x-auto">
          <pre>{{ JSON.stringify(job.parameters, null, 2) }}</pre>
        </div>
      </div>

      <!-- State History -->
      <div class="bg-zinc-900 border border-zinc-800 rounded p-5">
        <h3 class="text-xs font-mono text-zinc-600 uppercase tracking-wider mb-3 flex items-center gap-2">
          <History class="w-3.5 h-3.5" /> State
        </h3>
        <div v-if="job.state_details" class="space-y-3">
          <div class="flex items-center gap-3">
            <div class="w-2 h-2 rounded-full" :class="stateColor(job.state?.type)"></div>
            <div>
              <p class="text-sm font-mono font-medium text-zinc-300">{{ job.state?.type }}</p>
              <p class="text-xs font-mono text-zinc-600">{{ job.state?.message || '-' }}</p>
              <p class="text-xs font-mono text-zinc-700">{{ formatFull(job.state?.timestamp) }}</p>
            </div>
          </div>
        </div>
        <div v-else class="text-sm font-mono text-zinc-700">No state data</div>
      </div>
    </template>

    <div v-else class="text-center py-12 text-zinc-600 font-mono text-sm">Not found</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Settings, History } from 'lucide-vue-next'
import StatusBadge from '../components/StatusBadge.vue'
import api from '../api'
import dayjs from 'dayjs'

const route = useRoute()
const job = ref(null)
const loading = ref(true)

function formatFull(t) {
  return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-'
}

function formatDuration(start, end) {
  if (!start) return '-'
  const s = dayjs(start)
  const e = end ? dayjs(end) : dayjs()
  const sec = e.diff(s, 'second')
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

function stateColor(type) {
  const map = {
    COMPLETED: 'bg-emerald-500',
    FAILED: 'bg-red-500',
    RUNNING: 'bg-amber-500',
    PENDING: 'bg-zinc-500',
    SCHEDULED: 'bg-zinc-500',
  }
  return map[type] || 'bg-zinc-600'
}

onMounted(async () => {
  try {
    const res = await api.getJob(route.params.id)
    job.value = res.data
  } catch {
    job.value = null
  } finally {
    loading.value = false
  }
})
</script>
