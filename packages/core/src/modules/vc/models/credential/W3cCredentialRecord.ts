import type { TagsBase } from '../../../../storage/BaseRecord'

import { Type } from 'class-transformer'
import jsonld from 'jsonld'

import { BaseRecord } from '../../../../storage/BaseRecord'
import { uuid } from '../../../../utils/uuid'

import { W3cVerifiableCredential } from './W3cVerifiableCredential'

export interface W3cCredentialRecordOptions {
  id?: string
  createdAt?: Date
  credential: W3cVerifiableCredential
  tags: CustomW3cCredentialTags
}

export type CustomW3cCredentialTags = TagsBase & {
  expandedTypes?: Array<string>
}

export class W3cCredentialRecord extends BaseRecord<TagsBase, CustomW3cCredentialTags> {
  public static readonly type = 'W3cCredentialRecord'
  public readonly type = W3cCredentialRecord.type

  @Type(() => W3cVerifiableCredential)
  public credential!: W3cVerifiableCredential

  public constructor(props: W3cCredentialRecordOptions) {
    super()
    if (props) {
      this.id = props.id ?? uuid()
      this.createdAt = props.createdAt ?? new Date()
      this._tags = props.tags
      this.credential = props.credential
    }
  }

  public getTags() {
    return this._tags
  }
}