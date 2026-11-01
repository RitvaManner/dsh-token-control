/**
 * Peak/off-peak policy for calendar year 2026 — a standalone policy file.
 *
 * Source: 国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号），
 * published 2025-11-04,
 * https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 *
 * Rule implemented by `definition/peak.js`:
 *   - Saturday/Sunday                      -> idle
 *   - inside a `holidays` range            -> idle
 *   - Mon-Fri inside a `peakWindows` window -> peak
 *   - everything else                      -> idle
 *
 * `makeUpWorkdays` (调休上班的周末) are recorded for display and for future
 * strategies; they stay idle under the current rule because the peak rule is
 * weekday-only, exactly as the product requirement states.
 */

const PEAK_WINDOWS = Object.freeze([
  Object.freeze(['09:00', '12:00']),
  Object.freeze(['14:00', '18:00']),
]);

export const POLICY_2026 = Object.freeze({
  year: 2026,
  timeZone: 'Asia/Shanghai',
  source: 'https://www.gov.cn/zhengce/content/202511/content_7047090.htm',
  publishedAt: '2025-11-04',
  peakWindows: PEAK_WINDOWS,
  offPeakRatioOfPeak: 0.5,
  holidays: Object.freeze([
    Object.freeze({ name: '元旦', from: '2026-01-01', to: '2026-01-03' }),
    Object.freeze({ name: '春节', from: '2026-02-15', to: '2026-02-23' }),
    Object.freeze({ name: '清明节', from: '2026-04-04', to: '2026-04-06' }),
    Object.freeze({ name: '劳动节', from: '2026-05-01', to: '2026-05-05' }),
    Object.freeze({ name: '端午节', from: '2026-06-19', to: '2026-06-21' }),
    Object.freeze({ name: '中秋节', from: '2026-09-25', to: '2026-09-27' }),
    Object.freeze({ name: '国庆节', from: '2026-10-01', to: '2026-10-07' }),
  ]),
  makeUpWorkdays: Object.freeze([
    '2026-01-04',
    '2026-02-14',
    '2026-02-28',
    '2026-05-09',
    '2026-09-20',
    '2026-10-10',
  ]),
});

export default POLICY_2026;
