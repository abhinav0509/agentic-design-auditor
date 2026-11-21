-- What a fix changes for the person using the page (FR-10, D-050): the element's accessibility-tree
-- entry (role and name), or the declared page language, before and after, as the verifier rendered
-- them. Kept beside the proposal contract, which stays as v1.0 §8.1.
alter table proposals add column announced_before text;
alter table proposals add column announced_after text;
