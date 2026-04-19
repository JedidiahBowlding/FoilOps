import { describe, it, expect } from 'vitest'
import { classifyWalletProfile, classifyToken } from '../src/modules/foilops/services/classificationService'

describe('classifyWalletProfile', () => {
  it('classifies as early-entrant when opportunity is high and risk is low', () => {
    expect(classifyWalletProfile(75, 20)).toBe('early-entrant')
  })

  it('classifies as momentum-wallet for moderate opportunity and moderate risk', () => {
    expect(classifyWalletProfile(60, 50)).toBe('momentum-wallet')
  })

  it('classifies as high-risk when risk score exceeds threshold', () => {
    expect(classifyWalletProfile(80, 70)).toBe('high-risk')
  })

  it('classifies as watchlist when opportunity is moderate and risk is not extreme', () => {
    expect(classifyWalletProfile(40, 30)).toBe('watchlist')
  })

  it('classifies as ignore when opportunity is very low', () => {
    expect(classifyWalletProfile(10, 10)).toBe('ignore')
  })

  it('high-risk trumps high-opportunity', () => {
    expect(classifyWalletProfile(95, 75)).toBe('high-risk')
  })
})

describe('classifyToken', () => {
  it('classifies as safer-speculative for low risk score', () => {
    expect(classifyToken(15)).toBe('safer-speculative')
  })

  it('classifies as watchlist for medium risk', () => {
    expect(classifyToken(45)).toBe('watchlist')
  })

  it('classifies as high-risk for elevated risk', () => {
    expect(classifyToken(65)).toBe('high-risk')
  })

  it('classifies as extreme-risk for very high risk', () => {
    expect(classifyToken(80)).toBe('extreme-risk')
  })

  it('boundary: score at saferMax is still safer-speculative', () => {
    expect(classifyToken(30)).toBe('safer-speculative')
  })

  it('boundary: score just above saferMax is watchlist', () => {
    expect(classifyToken(31)).toBe('watchlist')
  })
})
