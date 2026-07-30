const { DynamoDBClient } = require('@aws-sdk/client-dynamodb')
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  BatchGetCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb')

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
const doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } })

const TABLE_NAME = process.env.TABLE_NAME

async function get(pk, sk) {
  const res = await doc.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk, sk } }))
  return res.Item
}

async function put(item) {
  await doc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
  return item
}

async function del(pk, sk) {
  await doc.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk, sk } }))
}

async function query(params) {
  const res = await doc.send(new QueryCommand({ TableName: TABLE_NAME, ...params }))
  return res.Items || []
}

async function batchGet(keys) {
  if (!keys.length) return []
  const res = await doc.send(new BatchGetCommand({ RequestItems: { [TABLE_NAME]: { Keys: keys } } }))
  return res.Responses?.[TABLE_NAME] || []
}

async function transactWrite(items) {
  await doc.send(new TransactWriteCommand({ TransactItems: items }))
}

module.exports = { doc, TABLE_NAME, get, put, del, query, batchGet, transactWrite }
