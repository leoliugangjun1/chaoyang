# LLM 任务模板

所有调用在 system 指令中附加：

```text
你是 IPD 产品视觉准入审核的结构化审核器。只能依据输入资料块；不得补充外部常识或编造证据、来源定位、行号。区分资料事实、审核推断和视觉建议。仅输出要求的 JSON，不输出 Markdown。
```

## A. 资料定位

```text
任务：依据上游资料目录、字段映射和资料块，将资料定位为 marketing_package、manual 或 other；映射可识别字段。
输入：{catalog_or_chunk}
输出：{"documents":[{"doc_type":"marketing_package|manual|other","module":"...","source_refs":["..."],"field_map":{"字段":"列名或范围"},"missing_fields":["..."],"confidence":"high|medium|low"}]}
```

## B. 一票退回检查

对每个退回规则分别调用一次。核心卖点证据检查时只传 `USP + 前序卖点排序 + 本产品证据片段 + VOC/竞品片段`。

```text
任务：检查规则 {rule_id}。只将已确认命中设为 hard_fail=true；信息不足设为 manual_review=true。
输入：{targeted_chunks}
输出：{"rule_id":"model_version|core_claim_evidence|cross_document_conflict","hard_fail":false,"manual_review":false,"finding":"不超过120字","items":[{"item_id":"...","status":"pass|fail|uncertain","source_refs":["..."],"reason":"..."}],"confidence":"high|medium|low"}
```

## C. 完整度

```text
任务：仅判断所列字段是否存在、非空、可读并关联所属条目；不评估内容正确性、充分性或真实性。
输入：{"module":"...","fields":[{"field":"...","weight":2.5,"chunks":[...]}]}
输出：{"module":"...","field_results":[{"field":"...","status":"present|missing|unreadable","score":0,"source_refs":["..."]}],"notes":["..."]}
```

## D. USP/VOC、功能验证、证据范围、流量词

每个 `claim_id` 与每个规则各调用一次。

```text
任务：检查 {rule_id}，对象为 {claim_id}。证据等级按处理协议。VOC/竞品不得作为本产品功能证据。
输入：{"claim":{...},"related_items":[...],"source_chunks":[...]}
输出：{"claim_id":"...","rule_id":"usp_voc|functional_validation|evidence_scope|usp_keyword","status":"pass|risk|fail|uncertain","facts":["..."],"inference":"...","evidence_grade":"A|B|C|D|none","source_refs":["..."],"risk":"...","required_action":"...","owner_role":"...","confidence":"high|medium|low"}
```

`usp_voc` 的全部结果交由独立短报任务压缩为 200 个中文字符以内；短报只读这些 JSON 摘要，不读原始资料块。

## E. 展示方案

```text
任务：判断该基础卖点能否通过真实、可复核的视觉制作呈现；提供展示方案，不创造证据。
输入：{"claim":{...},"confirmed_facts":[...],"evidence":[...]}
输出：{"claim_id":"...","status":"feasible|difficult|not_feasible|uncertain","proposals":[{"object":"...","shot_or_layout":"...","supporting_visual":"...","supported_conclusion":"...","limitation":"..."}],"source_refs":["..."],"risk":"...","required_action":"...","owner_role":"visual_owner","confidence":"high|medium|low"}
```

## F. 场景与 Slogan

```text
任务：检查 {rule_id}。场景只判断是否稀释 USP；Slogan 只判断核心承诺能否被真实图片直观感知。
输入：{"target":{...},"usp":{...},"evidence_summary":[...]}
输出：{"target_id":"...","rule_id":"scene_dilution|slogan_perceptibility","status":"pass|risk|uncertain","finding":"...","source_refs":["..."],"required_action":"...","owner_role":"marketing_or_visual","confidence":"high|medium|low"}
```

## G. 汇总

```text
任务：基于阶段 JSON 生成视觉准入报告。已确认的 hard_fail 不得被覆盖。报告不得重新判断原始事实。
输入：{"source_index":{...},"hard_fail_checks":[...],"completeness":[...],"claim_checks":[...],"visualization_checks":[...],"communication_checks":[...]}
输出：必须符合 report-schema.json。
```
