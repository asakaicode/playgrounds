-- Atomically join the waiting room.
--
-- KEYS[1] = wr:user:{userId}    (Hash)
-- KEYS[2] = wr:sale:started     (String "0"/"1")
-- KEYS[3] = wr:prequeue         (Set)
-- KEYS[4] = wr:counter:issued   (String, numeric)
--
-- ARGV[1] = userId
-- ARGV[2] = nowMs
-- ARGV[3] = userRecordTtlSeconds
--
-- Returns { state, positionStr } where positionStr is "" when there is no
-- position yet (prequeue).

local userKey = KEYS[1]
local saleStartedKey = KEYS[2]
local prequeueKey = KEYS[3]
local issuedCounterKey = KEYS[4]

local userId = ARGV[1]
local nowMs = ARGV[2]
local ttlSeconds = tonumber(ARGV[3])

-- Idempotent re-join: a user who already has a record keeps their state.
local existingState = redis.call('HGET', userKey, 'state')
if existingState then
  local existingPos = redis.call('HGET', userKey, 'position')
  if existingPos then
    return { existingState, existingPos }
  end
  return { existingState, '' }
end

local saleStarted = redis.call('GET', saleStartedKey)

if saleStarted ~= '1' then
  redis.call('SADD', prequeueKey, userId)
  redis.call('HSET', userKey, 'state', 'prequeue', 'joinedAt', nowMs)
  redis.call('EXPIRE', userKey, ttlSeconds)
  return { 'prequeue', '' }
end

local position = redis.call('INCR', issuedCounterKey)
redis.call('HSET', userKey, 'state', 'waiting', 'position', position, 'joinedAt', nowMs)
redis.call('EXPIRE', userKey, ttlSeconds)
return { 'waiting', tostring(position) }
