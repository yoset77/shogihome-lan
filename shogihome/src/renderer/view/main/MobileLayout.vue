<template>
  <div class="full">
    <div class="full row">
      <div class="column" style="overflow: hidden">
        <BoardPane
          :max-size="boardPaneMaxSize"
          :layout-type="boardLayoutType"
          @resize="onBoardPaneResize"
        />
        <MobileControls
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          :style="{ height: `${controlPaneHeight}px` }"
        />
        <PuzzlePane
          v-if="showRecordViewOnBottom && isEvaluationPuzzle"
          :style="{ height: `${bottomViewSize.height + controlPaneHeight + selectorHeight}px` }"
        />
        <RecordPane
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          v-show="bottomUIType === BottomUIType.RECORD"
          :style="{
            width: `${windowSize.width}px`,
            height: `${bottomViewSize.height}px`,
          }"
          :show-top-control="false"
          :show-bottom-control="false"
          :show-elapsed-time="true"
          :show-comment="true"
        />
        <RecordComment
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          v-show="bottomUIType === BottomUIType.COMMENT"
          :style="{
            width: `${windowSize.width}px`,
            height: `${bottomViewSize.height}px`,
          }"
        />
        <RecordInfo
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          v-show="bottomUIType === BottomUIType.INFO"
          :size="bottomViewSize"
        />
        <EngineAnalytics
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          v-show="bottomUIType === BottomUIType.PV"
          :size="bottomViewSize"
          :history-mode="false"
          :mobile-layout="true"
          :show-header="false"
          :show-time-column="false"
          :show-multi-pv-column="false"
          :show-depth-column="false"
          :show-nodes-column="false"
          :show-score-column="false"
        />
        <EvaluationChart
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          v-show="bottomUIType === BottomUIType.CHART"
          :size="bottomViewSize"
          :type="EvaluationChartType.RAW"
          :thema="appSettings.thema"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
        />
        <HorizontalSelector
          v-if="showRecordViewOnBottom && !isEvaluationPuzzle"
          v-model:value="bottomUIType"
          :items="[
            { label: t.pv, value: BottomUIType.PV },
            { label: t.chart, value: BottomUIType.CHART },
            { label: t.record, value: BottomUIType.RECORD },
            { label: t.comments, value: BottomUIType.COMMENT },
            { label: t.recordProperties, value: BottomUIType.INFO },
          ]"
          :height="selectorHeight"
          :scroll="true"
        />
      </div>
      <div
        v-if="!showRecordViewOnBottom"
        class="column"
        :style="{ width: `${windowSize.width - boardPaneSize.width}px`, overflow: 'hidden' }"
      >
        <MobileControls v-if="!isEvaluationPuzzle" :style="{ height: `${controlPaneHeight}px` }" />
        <PuzzlePane v-if="isEvaluationPuzzle" class="full" />
        <RecordPane
          v-if="!isEvaluationPuzzle"
          v-show="sideUIType === SideUIType.RECORD"
          :style="{ height: `${sideViewSize.height * 0.6}px` }"
          :show-top-control="false"
          :show-bottom-control="false"
          :show-elapsed-time="true"
          :show-comment="true"
        />
        <RecordComment
          v-if="!isEvaluationPuzzle"
          v-show="sideUIType === SideUIType.RECORD"
          :style="{
            'margin-top': '5px',
            height: `${sideViewSize.height * 0.4 - 5}px`,
          }"
        />
        <RecordInfo
          v-if="!isEvaluationPuzzle"
          v-show="sideUIType === SideUIType.INFO"
          :size="sideViewSize"
        />
        <EngineAnalytics
          v-if="!isEvaluationPuzzle"
          v-show="sideUIType === SideUIType.PV"
          :size="sideViewSize"
          :history-mode="false"
          :mobile-layout="true"
          :show-header="false"
          :show-time-column="false"
          :show-multi-pv-column="false"
          :show-depth-column="false"
          :show-nodes-column="false"
          :show-score-column="false"
        />
        <EvaluationChart
          v-if="!isEvaluationPuzzle"
          v-show="sideUIType === SideUIType.CHART"
          :size="sideViewSize"
          :type="EvaluationChartType.RAW"
          :thema="appSettings.thema"
          :coefficient-in-sigmoid="appSettings.coefficientInSigmoid"
        />
        <HorizontalSelector
          v-if="!isEvaluationPuzzle"
          v-model:value="sideUIType"
          :items="[
            { label: t.pv, value: SideUIType.PV },
            { label: t.chart, value: SideUIType.CHART },
            { label: t.record, value: SideUIType.RECORD },
            { label: t.recordProperties, value: SideUIType.INFO },
          ]"
          :height="selectorHeight"
          :scroll="true"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
enum BottomUIType {
  RECORD = "record",
  COMMENT = "comment",
  INFO = "info",
  PV = "pv",
  CHART = "chart",
}
enum SideUIType {
  RECORD = "record",
  INFO = "info",
  PV = "pv",
  CHART = "chart",
}
</script>

<script setup lang="ts">
import { RectSize } from "@/common/assets/geometry";
import { BoardLayoutType, EvaluationChartType } from "@/common/settings/layout";
import { Lazy } from "@/renderer/helpers/lazy";
import BoardPane from "@/renderer/view/main/BoardPane.vue";
import RecordPane from "@/renderer/view/main/RecordPane.vue";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import MobileControls from "./MobileControls.vue";
import RecordComment from "@/renderer/view/tab/RecordComment.vue";
import HorizontalSelector from "@/renderer/view/primitive/HorizontalSelector.vue";
import { t } from "@/common/i18n";
import RecordInfo from "@/renderer/view/tab/RecordInfo.vue";
import EngineAnalytics from "@/renderer/view/tab/EngineAnalytics.vue";
import EvaluationChart from "@/renderer/view/tab/EvaluationChart.vue";
import PuzzlePane from "@/renderer/view/tab/PuzzlePane.vue";
import { useAppSettings } from "@/renderer/store/settings";
import { useStore } from "@/renderer/store";
import { AppState } from "@/common/control/state";

const lazyUpdateDelay = 80;
const selectorHeight = 30;
const minRecordViewWidth = 250;
const minRecordViewHeight = 130;

const windowSize = reactive(new RectSize(window.innerWidth, window.innerHeight));
const bottomUIType = ref(BottomUIType.RECORD);
const sideUIType = ref(SideUIType.RECORD);
const appSettings = useAppSettings();
const store = useStore();

const windowLazyUpdate = new Lazy();
const updateSize = () => {
  windowLazyUpdate.after(() => {
    windowSize.width = window.innerWidth;
    windowSize.height = window.innerHeight;
  }, lazyUpdateDelay);
};

const isEvaluationPuzzle = computed(() => {
  return store.appState === AppState.PUZZLE && store.puzzle?.type === "evaluation";
});

const showRecordViewOnBottom = computed(() => windowSize.height >= windowSize.width);
const controlPaneHeight = computed(() =>
  Math.min(windowSize.height * 0.08, windowSize.width * 0.12),
);
const boardPaneMaxSize = computed(() => {
  const maxSize = new RectSize(windowSize.width, windowSize.height);
  if (showRecordViewOnBottom.value) {
    maxSize.height -= controlPaneHeight.value + minRecordViewHeight;
  } else {
    maxSize.width -= minRecordViewWidth;
  }
  return maxSize;
});
const boardLayoutType = computed(() => {
  if (showRecordViewOnBottom.value) {
    return windowSize.width < windowSize.height * 0.57
      ? BoardLayoutType.PORTRAIT
      : BoardLayoutType.COMPACT;
  } else {
    return windowSize.width < windowSize.height * 1.77
      ? BoardLayoutType.PORTRAIT
      : BoardLayoutType.COMPACT;
  }
});

const boardPaneSize = ref(windowSize);
const onBoardPaneResize = (size: RectSize) => {
  boardPaneSize.value = size;
};

const bottomViewSize = computed(() => {
  return new RectSize(
    windowSize.width,
    windowSize.height - boardPaneSize.value.height - controlPaneHeight.value - selectorHeight,
  );
});
const sideViewSize = computed(() => {
  return new RectSize(
    windowSize.width - boardPaneSize.value.width,
    windowSize.height - controlPaneHeight.value - selectorHeight,
  );
});

onMounted(() => {
  window.addEventListener("resize", updateSize);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateSize);
});
</script>

<style scoped>
.controls button {
  font-size: 100%;
  width: 100%;
  height: 100%;
}
.controls button .icon {
  height: 68%;
}
</style>
