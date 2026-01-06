<template>
  <div class="puzzle-pane">
    <div class="content">
      <div class="buttons">
        <button
          v-for="(label, index) in labels"
          :key="index"
          class="choice-button"
          @click="answer(index)"
        >
          <div class="label">{{ label }}</div>
          <div class="range">{{ ranges[index] }}</div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/common/i18n";
import { useStore } from "@/renderer/store";

const store = useStore();

const labels = computed(() => [...t.evaluationThemes].reverse());
const ranges = ["~30%", "31~44%", "45~55%", "56~69%", "70%~"];

const answer = (index: number) => {
  store.answerEvaluation(4 - index);
};
</script>

<style scoped>
.puzzle-pane {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background-color: var(--main-bg-color);
  box-sizing: border-box;
}

.content {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 10px;
  box-sizing: border-box;
}

.buttons {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 800px;
}

.choice-button {
  flex: 1 1 140px; /* Allow growing, shrink base 140px */
  height: auto;
  min-height: 60px;
  cursor: pointer;
  background-color: var(--control-button-bg-color);
  color: var(--control-button-color);
  border: 1px solid var(--control-button-border-color);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 5px;
}

.choice-button:hover {
  background-color: var(--hovered-control-button-bg-color);
}

.choice-button .label {
  font-size: 1.1em;
  font-weight: bold;
}

.choice-button .range {
  font-size: 0.8em;
  opacity: 0.8;
}
</style>
