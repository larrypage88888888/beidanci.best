import type { PetInfo } from '../lib/types';

/** 词苗养成卡片（P0 §十 B5）：完成页展示树龄/枯萎/救活进度 */
export default function PetCard({ pet, reviveCards }: { pet: PetInfo | null; reviveCards?: number }) {
  if (!pet) return null;

  const wilted = pet.wilted;
  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 p-4 shadow-sm ring-1 ring-emerald-100">
      <div className="flex items-center gap-3">
        <span className={`text-4xl ${wilted ? 'grayscale' : ''}`}>{pet.emoji}</span>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-sm font-bold text-emerald-700">
            {pet.stageLabel} · 树龄 {pet.treeAgeDays} 天
          </p>
          {wilted ? (
            <p className="mt-0.5 text-xs leading-relaxed text-amber-600">
              🌧️ 词苗枯萎了！
              {pet.needsWords != null && pet.needsWords > 0 ? (
                <>再学 <b>{pet.needsWords}</b> 词救活</>
              ) : (
                <>本次学习已满足救活条件</>
              )}
              {reviveCards != null && reviveCards > 0 && <> · 复活卡 ×{reviveCards}</>}
            </p>
          ) : pet.revived ? (
            <p className="mt-0.5 text-xs font-medium text-emerald-600">🌱 成功救活，继续生长！</p>
          ) : (
            <p className="mt-0.5 text-xs text-emerald-500">每天学习让它长大；断签 48 小时内学满 5 词可救活</p>
          )}
          {pet.hardReset && (
            <p className="mt-0.5 text-xs text-red-400">枯萎太久，树已重新生长为词苗 🌱</p>
          )}
        </div>
      </div>
      {/* 树龄刻度 */}
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-emerald-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all"
          style={{ width: `${Math.min(100, (pet.treeAgeDays / 14) * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-emerald-400">树龄 14 天开花结果 🌸</p>
    </div>
  );
}
