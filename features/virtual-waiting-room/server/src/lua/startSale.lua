-- Fisher-Yates shuffle the prequeue set and flip the sale-started flag.
--
-- KEYS[1] = wr:prequeue        (Set)
-- KEYS[2] = wr:sale:started    (String "0"/"1")
-- KEYS[3] = wr:counter:issued  (String, numeric)
--
-- Returns an array of userIds in their newly shuffled order (position 1..N).
-- The caller (queue.ts) is responsible for writing wr:user:{id} hashes in
-- chunks, since a single Lua invocation blocks the whole Redis instance.
--
-- Running this while wr:sale:started == "1" is a no-op (returns an empty
-- array) so a double-click on "start sale" cannot re-shuffle or re-number
-- anyone.

local prequeueKey = KEYS[1]
local saleStartedKey = KEYS[2]
local issuedCounterKey = KEYS[3]

local alreadyStarted = redis.call('GET', saleStartedKey)
if alreadyStarted == '1' then
  return {}
end

local members = redis.call('SMEMBERS', prequeueKey)
local n = #members

-- Seed math.random from Redis TIME so repeated runs (e.g. in tests) don't
-- produce identical shuffles.
local time = redis.call('TIME')
math.randomseed(tonumber(time[1]) * 1000000 + tonumber(time[2]))

-- Fisher-Yates shuffle, in place.
for i = n, 2, -1 do
  local j = math.random(i)
  members[i], members[j] = members[j], members[i]
end

redis.call('SET', saleStartedKey, '1')
redis.call('SET', issuedCounterKey, n)
redis.call('DEL', prequeueKey)

return members
