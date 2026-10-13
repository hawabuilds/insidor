-- 0046_judge_picture.sql
--
-- THE JUDGE CAN NOW BE SHOWN A POST'S STILL PICTURE, and records that it was.
--
-- Until now a still image was never sent: a post was judged on its words, and a post whose meme
-- is the picture ("Mogged.", a bare link) was judged on almost nothing. The gold sheets say 82% of
-- coined posts "work as a photo", so the judge is shown the first still picture of a subject with
-- no video, and its answer is recorded as `picture` — a third kind of evidence beside `text` and
-- `videoFrame`, held to its own bar in policy (`qualify.minJudgeConfidence.picture`).
--
-- Only the check constraints change. Rows already written keep what they were judged on.

alter table internal.judgement drop constraint if exists judgement_looked_at_check;
alter table internal.judgement
  add constraint judgement_looked_at_check check (looked_at in ('text', 'picture', 'videoFrame'));

alter table internal.post_judgement drop constraint if exists post_judgement_looked_at_check;
alter table internal.post_judgement
  add constraint post_judgement_looked_at_check check (looked_at in ('text', 'picture', 'videoFrame'));
