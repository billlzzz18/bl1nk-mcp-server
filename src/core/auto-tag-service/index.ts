  import { config } from '../../utils/config';
  import { logger } from '../../utils/logger';

  export interface TagResult {
    tags: string[];
    confidence: number;
  }

  export interface NamedEntity {
    type: 'person' | 'organization' | 'location' | 'technology';
    value: string;
    confidence: number;
  }

  export interface CacheEntry {
    result: TagResult;
    timestamp: number;
  }

  export class AutoTagService {
    private thaiKeywords: Map<string, string[]> = new Map([
      ['องค์กร', ['บริษัท', 'หน่วยงาน', 'สถาบัน', 'มหาวิทยาลัย', 'โรงเรียน']],
      ['เทคโนโลยี', ['AI', 'ปัญญาประดิษฐ์', 'คอมพิวเตอร์', 'ซอฟต์แวร์', 'ระบบ']],
      ['วิจัย', ['งานวิจัย', 'การศึกษา', 'ทดลอง', 'วิเคราะห์', 'พัฒนา']],
      ['สถานที่', ['กรุงเทพ', 'ไทย', 'ประเทศ', 'จังหวัด', 'เมือง', 'ที่ตั้ง']],
      ['บุคคล', ['นาย', 'นาง', 'ดร.', 'ศาสตราจารย์', 'ผู้อำนวยการ']]
    ]);

    private englishKeywords: Map<string, string[]> = new Map([
      ['organization', ['company', 'institution', 'university', 'school', 'agency']],
      ['technology', ['AI', 'artificial intelligence', 'computer', 'software', 'system']],
      ['research', ['study', 'analysis', 'experiment', 'development', 'investigation']],
      ['location', ['Bangkok', 'Thailand', 'country', 'province', 'city', 'place']],
      ['person', ['Dr.', 'Professor', 'Director', 'Manager', 'CEO']]
    ]);

    private tagCache: Map<string, CacheEntry> = new Map();
    private cacheMaxAge: number = 1000 * 60 * 60; // 1 hour
    private maxCacheSize: number = 1000;

    // Named Entity Recognition patterns
    private nerPatterns = {
      person: {
        th: /(?:นาย|นาง|ดร\.|ศาสตราจารย์|ผู้อำนวยการ)\s+[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)?/g,
        en: /(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g
      },
      organization: {
        th: /[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)*\s+(?:บริษัท|หน่วยงาน|สถาบัน|มหาวิทยาลัย)/g,
        en: /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Inc|Ltd|Corp|Co|University|Institute)/g
      },
      location: {
        th: /[\u0E00-\u0E7F]+(?:\s+[\u0E00-\u0E7F]+)*(?:จังหวัด|เมือง|ประเทศ)/g,
        en: /(?:Bangkok|Thailand|New York|London|Tokyo|[A-Z][a-z]+)/g
      },
      technology: {
        th: /(?:AI|API|JSON|HTTP|SQL|Python|JavaScript|React|Node\.js|TypeScript)/g,
        en: /(?:AI|API|JSON|HTTP|SQL|Python|JavaScript|React|Node\.js|TypeScript|Machine Learning|Deep Learning)/g
      }
    };

    generateTags(text: string, entityType?: string): TagResult {
      const cacheKey = this.generateCacheKey(text, entityType);
      
      // Check cache
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for key: ${cacheKey}`);
        return cached;
      }

      const language = config.tagging.language;
      const mode = config.tagging.mode;

      const tags = new Set<string>();
      let confidence = 0.5;

      // Add entity type as tag
      if (entityType) {
        tags.add(entityType.toLowerCase());
        confidence += 0.1;
      }

      // Extract named entities
      const entities = this.extractNamedEntities(text, language);
      entities.forEach(entity => {
        tags.add(entity.value.toLowerCase());
        confidence += entity.confidence * 0.1;
      });

      switch (mode) {
        case 'basic':
          this.addBasicTags(text, language, tags);
          break;
        case 'advanced':
          this.addAdvancedTags(text, language, tags);
          confidence += 0.2;
          break;
        case 'ml':
          this.addMLTags(text, language, tags);
          confidence += 0.3;
          break;
      }

      const result = {
        tags: Array.from(tags),
        confidence: Math.min(confidence, 1.0)
      };

      // Save to cache
      this.saveToCache(cacheKey, result);

      logger.debug(`Generated ${result.tags.length} tags for text (${language}, ${mode}):`, result.tags);
      return result;
    }

    private extractNamedEntities(text: string, language: 'th' | 'en'): NamedEntity[] {
      const entities: NamedEntity[] = [];
      const lang = language === 'th' ? 'th' : 'en';

      // Extract persons
      const personMatches = text.match(this.nerPatterns.person[lang]) || [];
      personMatches.forEach(match => {
        entities.push({
          type: 'person',
          value: match.trim(),
          confidence: 0.85
        });
      });

      // Extract organizations
      const orgMatches = text.match(this.nerPatterns.organization[lang]) || [];
      orgMatches.forEach(match => {
        entities.push({
          type: 'organization',
          value: match.trim(),
          confidence: 0.8
        });
      });

      // Extract locations
      const locMatches = text.match(this.nerPatterns.location[lang]) || [];
      locMatches.forEach(match => {
        entities.push({
          type: 'location',
          value: match.trim(),
          confidence: 0.75
        });
      });

      // Extract technology terms
      const techMatches = text.match(this.nerPatterns.technology[lang]) || [];
      techMatches.forEach(match => {
        entities.push({
          type: 'technology',
          value: match.trim(),
          confidence: 0.9
        });
      });

      return entities;
    }

    private addBasicTags(text: string, language: string, tags: Set<string>): void {
      const keywords = language === 'th' ? this.thaiKeywords : this.englishKeywords;
      const lowerText = text.toLowerCase();

      keywords.forEach((words, category) => {
        const matchCount = words.filter(word => lowerText.includes(word.toLowerCase())).length;
        if (matchCount > 0) {
          tags.add(category);
        }
      });
    }

    private addAdvancedTags(text: string, language: string, tags: Set<string>): void {
      this.addBasicTags(text, language, tags);

      const words = text.split(/\s+/);

      words.forEach(word => {
        if (/^[A-Z][a-z]+/.test(word) && word.length > 3) {
          tags.add(word.toLowerCase());
        }

        if (/[0-9]/.test(word) || /[A-Z]{2,}/.test(word)) {
          tags.add(word.toLowerCase());
        }

        if (language === 'th' && /[\u0E00-\u0E7F]/.test(word) && word.length > 2) {
          tags.add(word);
        }
      });

      if (text.includes('API') || text.includes('JSON') || text.includes('HTTP')) {
        tags.add('api');
        tags.add('web-service');
      }

      if (text.includes('database') || text.includes('ฐานข้อมูล')) {
        tags.add('database');
      }
    }

    private addMLTags(text: string, language: string, tags: Set<string>): void {
      this.addAdvancedTags(text, language, tags);

      const sentences = text.split(/[.!?]+/);

      sentences.forEach(sentence => {
        const lowerSentence = sentence.toLowerCase();

        if (lowerSentence.includes('research') || lowerSentence.includes('วิจัย')) {
          tags.add('research-project');
        }

        if (lowerSentence.includes('develop') || lowerSentence.includes('พัฒนา')) {
          tags.add('development');
        }

        if (lowerSentence.includes('analyze') || lowerSentence.includes('วิเคราะห์')) {
          tags.add('analysis');
        }

        if (lowerSentence.includes('important') || lowerSentence.includes('สำคัญ')) {
          tags.add('high-priority');
        }

        if (lowerSentence.includes('new') || lowerSentence.includes('ใหม่')) {
          tags.add('recent');
        }
      });

      if (text.includes('located in') || text.includes('ตั้งอยู่ที่')) {
        tags.add('location-info');
      }

      if (text.includes('works at') || text.includes('ทำงานที่')) {
        tags.add('employment');
      }
    }

    filterTags(tags: string[], minLength: number = 2, maxTags: number = 10): string[] {
      return tags
        .filter(tag => tag.length >= minLength)
        .filter(tag => !this.isStopWord(tag))
        .slice(0, maxTags);
    }

    private isStopWord(word: string): boolean {
      const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'และ', 'หรือ', 'แต่', 'ใน', 'บน', 'ที่', 'เพื่อ', 'ของ', 'กับ', 'โดย'
      ]);

      return stopWords.has(word.toLowerCase());
    }

    mergeTags(existingTags: string[], newTags: string[]): string[] {
      const merged = new Set([...existingTags, ...newTags]);
      return Array.from(merged);
    }

    // Cache management
    private generateCacheKey(text: string, entityType?: string): string {
      const textHash = text.slice(0, 50).replace(/\s+/g, '_');
      return `${textHash}-${entityType || 'default'}`;
    }

    private getFromCache(key: string): TagResult | null {
      const entry = this.tagCache.get(key);
      
      if (!entry) return null;

      const age = Date.now() - entry.timestamp;
      if (age > this.cacheMaxAge) {
        this.tagCache.delete(key);
        return null;
      }

      return entry.result;
    }

    private saveToCache(key: string, result: TagResult): void {
      // Clear old entries if cache is full
      if (this.tagCache.size >= this.maxCacheSize) {
        const firstKey = this.tagCache.keys().next().value;
        this.tagCache.delete(firstKey);
      }

      this.tagCache.set(key, {
        result,
        timestamp: Date.now()
      });
    }

    clearCache(): void {
      this.tagCache.clear();
      logger.info('Tag cache cleared');
    }

    getCacheStats(): { size: number; maxSize: number } {
      return {
        size: this.tagCache.size,
        maxSize: this.maxCacheSize
      };
    }
  }

  export const autoTagService = new AutoTagService();