UPDATE audio_tracks SET status = 'FAILED' WHERE status = 'PROCESSING';
SELECT id, status, has_sum FROM (SELECT id, status, summaries IS NOT NULL as has_sum FROM audio_tracks ORDER BY "createdAt" DESC LIMIT 5) t;
